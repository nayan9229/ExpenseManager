/**
 * Uploading a Receipt straight from the phone to the Receipt Store (spec
 * "Receipt pipeline (upload-first)", steps 4 to 6).
 *
 * `upload-url` opens a Drive resumable session for one file; the browser
 * PUTs the whole file to the session URL in one request and reads the new
 * file's ID from Drive's answer. A failed PUT is never resumed (Drive does
 * not expose the Range header cross-origin): the next try asks for a fresh
 * session and starts from byte 0.
 *
 * The session URL is a bearer secret (anyone holding it can upload into the
 * Admin's Drive). It is never logged, never stored, and never put into an
 * error message.
 */
import { ApiError } from './api'

/** Retries after the first try; four PUTs at most. */
export const MAX_RETRIES = 3

/** What `upload-url` needs to open a session. */
export type SessionRequest = {
  /** The temporary `<Expense ID>.<ext>` name. */
  name: string
  mimeType: string
  /** Bytes the PUT will send. */
  size: number
  /** `YYYY-MM-DD`; picks the `Receipts/YYYY/MM-Month` folder. */
  expenseDate: string
}

/** What `upload-url` answers. */
export type UploadSession = {
  /** The Drive session URL. Secret: never log it. */
  uploadUrl: string
  folderId: string
  folderPath: string
  name: string
}

/** Asks `upload-url` for a fresh resumable session. Rejects with an ApiError on a non-2xx answer. */
export async function requestUploadSession(req: SessionRequest, fetchImpl: typeof fetch = fetch): Promise<UploadSession> {
  const res = await fetchImpl('/api/upload-url', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(req),
  })
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    // A platform error page: fall through to the defaults below.
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof body['code'] === 'string' ? body['code'] : 'HTTP_ERROR',
      typeof body['message'] === 'string' ? body['message'] : `Request failed with status ${res.status}`,
    )
  }
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '')
  if (!str('uploadUrl')) throw new ApiError(res.status, 'BAD_RESPONSE', 'upload-url answered without a session')
  return { uploadUrl: str('uploadUrl'), folderId: str('folderId'), folderPath: str('folderPath'), name: str('name') }
}

/** The HTTP answer to a PUT. */
export type PutResult = { status: number; body: string }

/**
 * Sends `blob` to `url` in one PUT, reporting the fraction sent. Resolves
 * with any HTTP answer; rejects only when none arrived (offline, timeout,
 * CORS refusal).
 */
export type PutFile = (url: string, blob: Blob, onProgress?: (fraction: number) => void) => Promise<PutResult>

/**
 * The browser PUT. XMLHttpRequest rather than fetch because only XHR
 * reports upload progress. No credentials: the session URL is the auth.
 */
export const xhrPut: PutFile = (url, blob, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    // Content-Length is set by the browser from the body.
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream')
    xhr.timeout = 120_000
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText })
    // Deliberately no detail: the event carries nothing useful and the URL must not leak.
    xhr.onerror = () => reject(new TypeError('The upload did not reach Google Drive'))
    xhr.ontimeout = () => reject(new TypeError('The upload timed out'))
    xhr.onabort = () => reject(new TypeError('The upload was stopped'))
    xhr.send(blob)
  })

/** The upload failed for good (every try used up, or Drive's answer had no file ID). */
export class UploadFailed extends Error {
  /** How many PUTs (or session requests) were tried. */
  readonly attempts: number

  constructor(message: string, attempts: number) {
    super(message)
    this.name = 'UploadFailed'
    this.attempts = attempts
  }
}

/** A Receipt ready to upload: the shrunk JPEG or the untouched PDF. */
export type ReceiptUpload = {
  blob: Blob
  /** `<Expense ID>.<ext>`. */
  name: string
  mimeType: string
  expenseDate: string
}

/** The Receipt in Drive, under its temporary name until the Expense is saved. */
export type UploadedReceipt = {
  fileId: string
  folderPath: string
}

export type UploadDeps = {
  fetchImpl?: typeof fetch
  put?: PutFile
  /** Fraction of the current try sent, 0 to 1; restarts at 0 on a retry. */
  onProgress?: (fraction: number) => void
  /** Waits between tries; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Backoff before retry n (0-based): 1s, 2s, 4s. */
const backoff = (n: number) => 1000 * 2 ** n

/**
 * Uploads one Receipt: a session from `upload-url`, then one PUT of the
 * whole file. Any failed try (no answer, or a non-2xx from Drive or a
 * 5xx/429 from `upload-url`) is retried from scratch on a fresh session,
 * at most MAX_RETRIES times. A definite refusal from `upload-url` (401,
 * 413, 422...) is thrown as its ApiError straight away.
 */
export async function uploadReceipt(
  receipt: ReceiptUpload,
  { fetchImpl = fetch, put = xhrPut, onProgress, sleep = wait }: UploadDeps = {},
): Promise<UploadedReceipt> {
  let lastProblem = 'the connection dropped'
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(backoff(attempt - 1))
    onProgress?.(0)

    let session: UploadSession
    try {
      session = await requestUploadSession(
        { name: receipt.name, mimeType: receipt.mimeType, size: receipt.blob.size, expenseDate: receipt.expenseDate },
        fetchImpl,
      )
    } catch (err) {
      if (err instanceof ApiError && err.status < 500 && err.status !== 429) throw err
      lastProblem = err instanceof ApiError ? err.message : 'the server could not be reached'
      continue
    }

    let answer: PutResult
    try {
      answer = await put(session.uploadUrl, receipt.blob, onProgress)
    } catch {
      lastProblem = 'the connection dropped'
      continue
    }
    if (answer.status !== 200 && answer.status !== 201) {
      lastProblem = `Google Drive answered ${answer.status}`
      continue
    }
    const fileId = fileIdFrom(answer.body)
    if (!fileId) throw new UploadFailed('Google Drive took the file but did not say which one it is', attempt + 1)
    return { fileId, folderPath: session.folderPath }
  }
  throw new UploadFailed(`The Receipt did not upload after ${MAX_RETRIES + 1} tries: ${lastProblem}`, MAX_RETRIES + 1)
}

function fileIdFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { id?: unknown }
    return typeof parsed.id === 'string' && parsed.id !== '' ? parsed.id : null
  } catch {
    return null
  }
}
