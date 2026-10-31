import { describe, expect, test } from 'vitest'
import { ApiError } from './api'
import { MAX_RETRIES, UploadFailed, uploadReceipt, type PutFile, type PutResult } from './upload'

const ID = '6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10'

type SessionAnswer = { status: number; body: unknown } | 'network'

/**
 * A fake `upload-url` endpoint: every POST opens a new session with its own
 * URL (like Drive), unless the script says otherwise for that call.
 */
function fakeSessionEndpoint(script: SessionAnswer[] = []) {
  const requests: unknown[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url !== '/api/upload-url' || init?.method !== 'POST') throw new Error(`unexpected ${init?.method} ${url}`)
    requests.push(JSON.parse(String(init.body)))
    const answer = script[requests.length - 1] ?? {
      status: 200,
      body: { uploadUrl: `https://upload.test/session-${requests.length}`, folderId: 'm1', folderPath: 'Receipts/2026/10-October', name: `${ID}.jpg` },
    }
    if (answer === 'network') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetchImpl, requests }
}

type PutAnswer = PutResult | 'network'

/** A fake Drive session URL: records each PUT, answers from the script. */
function fakeDrive(script: PutAnswer[]) {
  const puts: { url: string; size: number; type: string }[] = []
  const put: PutFile = async (url, blob, onProgress) => {
    puts.push({ url, size: blob.size, type: blob.type })
    const answer = script[puts.length - 1]
    if (!answer) throw new Error('more PUTs than the test expected')
    if (answer === 'network') throw new TypeError('Network request failed')
    onProgress?.(1)
    return answer
  }
  return { put, puts }
}

const created = (id: string): PutResult => ({ status: 200, body: JSON.stringify({ kind: 'drive#file', id, name: `${ID}.jpg`, mimeType: 'image/jpeg' }) })
const noSleep = async () => {}

function receipt() {
  return { blob: new Blob([new Uint8Array(245_000)], { type: 'image/jpeg' }), name: `${ID}.jpg`, mimeType: 'image/jpeg', expenseDate: '2026-10-30' }
}

describe('uploadReceipt', () => {
  test('asks upload-url for a session, PUTs the whole file once and returns the Drive file ID', async () => {
    const sessions = fakeSessionEndpoint()
    const drive = fakeDrive([created('drive-file-1')])

    const uploaded = await uploadReceipt(receipt(), { fetchImpl: sessions.fetchImpl, put: drive.put, sleep: noSleep })

    expect(uploaded).toEqual({ fileId: 'drive-file-1', folderPath: 'Receipts/2026/10-October' })
    expect(sessions.requests).toEqual([{ name: `${ID}.jpg`, mimeType: 'image/jpeg', size: 245_000, expenseDate: '2026-10-30' }])
    expect(drive.puts).toEqual([{ url: 'https://upload.test/session-1', size: 245_000, type: 'image/jpeg' }])
  })

  test('a failed PUT is retried from scratch on a fresh session, never the old one', async () => {
    const sessions = fakeSessionEndpoint()
    const drive = fakeDrive(['network', { status: 503, body: '' }, created('drive-file-3')])

    const uploaded = await uploadReceipt(receipt(), { fetchImpl: sessions.fetchImpl, put: drive.put, sleep: noSleep })

    expect(uploaded.fileId).toBe('drive-file-3')
    expect(drive.puts.map((p) => p.url)).toEqual(['https://upload.test/session-1', 'https://upload.test/session-2', 'https://upload.test/session-3'])
    expect(drive.puts.every((p) => p.size === 245_000)).toBe(true)
  })

  test('an expired session (404) also gets a fresh session', async () => {
    const sessions = fakeSessionEndpoint()
    const drive = fakeDrive([{ status: 404, body: 'Not Found' }, created('drive-file-2')])

    const uploaded = await uploadReceipt(receipt(), { fetchImpl: sessions.fetchImpl, put: drive.put, sleep: noSleep })

    expect(uploaded.fileId).toBe('drive-file-2')
    expect(sessions.requests).toHaveLength(2)
  })

  test(`gives up after the first try plus ${MAX_RETRIES} retries`, async () => {
    const sessions = fakeSessionEndpoint()
    const drive = fakeDrive(['network', 'network', { status: 500, body: '' }, 'network'])

    const upload = uploadReceipt(receipt(), { fetchImpl: sessions.fetchImpl, put: drive.put, sleep: noSleep })

    await expect(upload).rejects.toBeInstanceOf(UploadFailed)
    await expect(upload).rejects.toMatchObject({ attempts: 4 })
    expect(drive.puts).toHaveLength(1 + MAX_RETRIES)
    expect(new Set(drive.puts.map((p) => p.url)).size).toBe(1 + MAX_RETRIES)
  })

  test('waits a little longer before each retry', async () => {
    const waits: number[] = []
    const drive = fakeDrive(['network', 'network', 'network', created('f')])

    await uploadReceipt(receipt(), { fetchImpl: fakeSessionEndpoint().fetchImpl, put: drive.put, sleep: async (ms) => void waits.push(ms) })

    expect(waits).toHaveLength(3)
    expect(waits[0]).toBeGreaterThan(0)
    expect(waits[1]).toBeGreaterThan(waits[0]!)
    expect(waits[2]).toBeGreaterThan(waits[1]!)
  })

  test('the session URL never appears in the failure message', async () => {
    const drive = fakeDrive(['network', 'network', 'network', { status: 403, body: 'rateLimitExceeded' }])

    const failure = await uploadReceipt(receipt(), { fetchImpl: fakeSessionEndpoint().fetchImpl, put: drive.put, sleep: noSleep }).catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(UploadFailed)
    expect(String((failure as Error).message)).not.toContain('upload.test')
    expect(JSON.stringify(failure)).not.toContain('upload.test')
  })

  test('a lost Session (401) is not retried and surfaces as the ApiError', async () => {
    const sessions = fakeSessionEndpoint([{ status: 401, body: { code: 'NOT_PAIRED', message: 'Pair this device again' } }])
    const drive = fakeDrive([])

    const upload = uploadReceipt(receipt(), { fetchImpl: sessions.fetchImpl, put: drive.put, sleep: noSleep })

    await expect(upload).rejects.toBeInstanceOf(ApiError)
    await expect(upload).rejects.toMatchObject({ status: 401, code: 'NOT_PAIRED' })
    expect(sessions.requests).toHaveLength(1)
    expect(drive.puts).toHaveLength(0)
  })

  test('a refused file (4xx from upload-url) is not retried', async () => {
    const sessions = fakeSessionEndpoint([{ status: 413, body: { code: 'FILE_TOO_LARGE', message: 'The file is over 20 MB' } }])

    const upload = uploadReceipt(receipt(), { fetchImpl: sessions.fetchImpl, put: fakeDrive([]).put, sleep: noSleep })

    await expect(upload).rejects.toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' })
    expect(sessions.requests).toHaveLength(1)
  })

  test('upload-url being unreachable or failing upstream counts as a failed try', async () => {
    const sessions = fakeSessionEndpoint(['network', { status: 502, body: { code: 'GOOGLE_ERROR', message: 'drive: 503' } }])
    const drive = fakeDrive([created('drive-file-9')])

    const uploaded = await uploadReceipt(receipt(), { fetchImpl: sessions.fetchImpl, put: drive.put, sleep: noSleep })

    expect(uploaded.fileId).toBe('drive-file-9')
    expect(sessions.requests).toHaveLength(3)
    expect(drive.puts).toHaveLength(1)
  })

  test('a 2xx without a file ID is not retried: the file is in Drive, a retry would upload it twice', async () => {
    const drive = fakeDrive([{ status: 200, body: '' }])

    const upload = uploadReceipt(receipt(), { fetchImpl: fakeSessionEndpoint().fetchImpl, put: drive.put, sleep: noSleep })

    await expect(upload).rejects.toBeInstanceOf(UploadFailed)
    expect(drive.puts).toHaveLength(1)
  })

  test('reports progress from 0 on each try', async () => {
    const seen: number[] = []
    const drive = fakeDrive(['network', created('f')])

    await uploadReceipt(receipt(), { fetchImpl: fakeSessionEndpoint().fetchImpl, put: drive.put, sleep: noSleep, onProgress: (p) => seen.push(p) })

    expect(seen).toEqual([0, 0, 1])
  })
})
