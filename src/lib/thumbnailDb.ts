import Dexie, { type DexieOptions, type EntityTable } from 'dexie'

/**
 * The Receipt thumbnail cache (spec "Receipt viewing": cached in Dexie keyed
 * by file ID), so the last five render with their thumbnails offline.
 *
 * It is its own small database on purpose: the Offline Queue (ticket 09)
 * owns the main Dexie database, and keeping thumbnails apart means neither
 * schema can break the other. They can be folded together later.
 */
export const THUMBNAIL_DB_NAME = 'receipt-thumbnails'

/** One cached thumbnail. */
export type CachedThumbnail = {
  /** The Receipt's Drive file ID (Expense `driveFileId`). */
  fileId: string
  /** Drive's generated thumbnail image. */
  blob: Blob
  /** The Receipt's own MIME type (`image/jpeg`, `application/pdf`), from `X-Receipt-Type`. */
  receiptType: string
  /** `Date.now()` when stored; the oldest go first when the cache is trimmed. */
  savedAt: number
}

export class ThumbnailDb extends Dexie {
  thumbnails!: EntityTable<CachedThumbnail, 'fileId'>

  /** Tests pass a fresh name and fake-indexeddb in `options`. */
  constructor(name: string = THUMBNAIL_DB_NAME, options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({ thumbnails: 'fileId, savedAt' })
  }
}

let shared: ThumbnailDb | null = null

/** The app's one thumbnail database, opened on first use. */
export function thumbnailDb(): ThumbnailDb {
  shared ??= new ThumbnailDb()
  return shared
}
