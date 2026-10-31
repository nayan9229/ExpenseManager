/**
 * Receipt viewing (spec "Receipt viewing", ADR-0003): the `receipt` function
 * serves a Receipt's bytes or Drive's thumbnail through the server's token,
 * so no phone ever needs a Google login. Thumbnails are cached in Dexie by
 * file ID so the last five render offline.
 */
import { ApiError } from './api'
import { appDb, type CachedThumbnail, type ExpenseDb } from './db'

export type ReceiptDeps = {
  db?: ExpenseDb
  fetchImpl?: typeof fetch
  now?: () => number
}

/**
 * How many thumbnails the device keeps. The list shows five; the rest are
 * Expenses scrolled past before. Drive thumbnails are tens of KB each.
 */
export const MAX_THUMBNAILS = 100

/** The `receipt` function's URL for a file, or for its thumbnail. */
export function receiptUrl(fileId: string, opts: { thumb?: boolean } = {}): string {
  const q = `id=${encodeURIComponent(fileId)}`
  return `/api/receipt?${q}${opts.thumb ? '&thumb=1' : ''}`
}

async function errorOf(res: Response): Promise<ApiError> {
  let body: { code?: unknown; message?: unknown } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {
    // A platform error page: keep the defaults.
  }
  return new ApiError(
    res.status,
    typeof body.code === 'string' ? body.code : 'HTTP_ERROR',
    typeof body.message === 'string' ? body.message : `Request failed with status ${res.status}`,
    body,
  )
}

/**
 * The thumbnail of a Receipt: from Dexie when cached, else fetched from
 * `receipt?thumb=1` and stored. Null when Drive has not made one yet
 * (nothing is stored, so the next call asks again). Rejects with an ApiError (or the network's
 * TypeError when offline and not cached).
 */
export async function getThumbnail(fileId: string, deps: ReceiptDeps = {}): Promise<CachedThumbnail | null> {
  const db = deps.db ?? appDb()
  const cached = await db.thumbnails.get(fileId)
  if (cached) return cached
  const res = await (deps.fetchImpl ?? fetch)(receiptUrl(fileId, { thumb: true }), { credentials: 'same-origin' })
  if (!res.ok) {
    const err = await errorOf(res)
    // Drive makes thumbnails shortly after an upload; ask again next time.
    if (err.code === 'NO_THUMBNAIL') return null
    throw err
  }
  const blob = await res.blob()
  const row: CachedThumbnail = {
    fileId,
    blob,
    receiptType: res.headers.get('X-Receipt-Type') ?? '',
    savedAt: (deps.now ?? Date.now)(),
  }
  await db.transaction('rw', db.thumbnails, async () => {
    await db.thumbnails.put(row)
    const extra = (await db.thumbnails.count()) - MAX_THUMBNAILS
    if (extra > 0) await db.thumbnails.orderBy('savedAt').limit(extra).delete()
  })
  return row
}

/** What the ReceiptLightbox shows. */
export type ReceiptView =
  /** A photo, whole. */
  | { kind: 'image'; image: Blob }
  /** A PDF: Drive's first-page thumbnail, and the Drive link to read the rest. */
  | { kind: 'pdf'; thumb: Blob | null; driveUrl: string }
  /** Over the 4 MB proxy cap (ADR-0003): the thumbnail plus "Open in Google Drive". */
  | { kind: 'tooLarge'; thumb: Blob | null; driveUrl: string }
  /** No network: the cached thumbnail is all there is. */
  | { kind: 'offline'; thumb: Blob }

/**
 * Everything the lightbox needs for one Receipt. The cached thumbnail says
 * whether it is a PDF before anything is downloaded; a photo is then
 * fetched whole. `driveViewUrl` is the Expense's Drive link. Rejects with
 * an ApiError (404, 401, 502) or, offline with no thumbnail cached, the
 * network's TypeError.
 */
export async function loadReceiptView(fileId: string, driveViewUrl: string, deps: ReceiptDeps = {}): Promise<ReceiptView> {
  const cached = await getThumbnail(fileId, deps).catch(() => null)
  const thumb = cached?.blob ?? null
  if (cached?.receiptType === PDF) return { kind: 'pdf', thumb, driveUrl: driveViewUrl }

  let res: Response
  try {
    res = await (deps.fetchImpl ?? fetch)(receiptUrl(fileId), { credentials: 'same-origin' })
  } catch (err) {
    // Offline (fetch rejects with a TypeError): the cached thumbnail will do.
    if (thumb && err instanceof TypeError) return { kind: 'offline', thumb }
    throw err
  }
  if (res.status === 413) {
    const err = await errorOf(res)
    const link = (err.body as { webViewLink?: unknown }).webViewLink
    return { kind: 'tooLarge', thumb, driveUrl: typeof link === 'string' && link ? link : driveViewUrl }
  }
  if (!res.ok) throw await errorOf(res)
  const body = await res.blob()
  if (body.type === PDF) return { kind: 'pdf', thumb, driveUrl: driveViewUrl }
  return { kind: 'image', image: body }
}

const PDF = 'application/pdf'
