/**
 * Receipt viewing (spec "Receipt viewing", ADR-0003): the `receipt` function
 * serves a Receipt's bytes or Drive's thumbnail through the server's token,
 * so no phone ever needs a Google login. Thumbnails are cached in Dexie by
 * file ID so the last five render offline.
 */
import { ApiError } from './api'
import { thumbnailDb, type CachedThumbnail, type ThumbnailDb } from './thumbnailDb'

export type ReceiptDeps = {
  db?: ThumbnailDb
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
  const db = deps.db ?? thumbnailDb()
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
