/**
 * The device's own database (Dexie over IndexedDB): the Offline Queue, the
 * last read model the server sent, the device settings and the Receipt
 * thumbnail cache.
 *
 * Schema changes add a new `version(n)` block; never edit an old one.
 */
import Dexie, { type DexieOptions, type Table } from 'dexie'
import type { CreateExpenseInput, ReadModel, UpdateExpenseInput } from './api'

export const DB_NAME = 'family-expenses'

/**
 * Where ticket 08 kept the thumbnails before they moved into `thumbnails`
 * (version 2). It is only a cache, so the first open at version 2 deletes it
 * instead of copying it.
 */
export const LEGACY_THUMBNAIL_DB_NAME = 'receipt-thumbnails'

/** `pending` waits for Sync; `needs-attention` was refused for good and waits for Retry or Discard. */
export type QueueState = 'pending' | 'needs-attention'

/** Why the last try failed. `status` 0 means no answer arrived (offline, timeout). */
export type QueueError = {
  status: number
  code: string
  message: string
  /** The server's whole error body (a 409 DUPLICATE_RECEIPT carries the earlier Expense). */
  body?: unknown
}

/** A Receipt saved on the phone: the prepared upload body, its type, and the SHA-256 of the original. */
export type QueuedReceipt = {
  blob: Blob
  mimeType: string
  /** `jpg` or `pdf`; the upload name is `<Expense ID>.<ext>`. */
  ext: string
  fileHash: string
}

type QueueItemBase = {
  /** Auto-incremented: Sync replays in this order. */
  seq?: number
  /** The Expense this item changes. */
  expenseId: string
  /** RFC 3339 in IST, when the Member tapped Save. */
  queuedAt: string
  attempts: number
  lastError: QueueError | null
  state: QueueState
}

/** One Offline Queue entry (GLOSSARY: Offline Queue). */
export type QueueItem =
  | (QueueItemBase & {
      kind: 'create'
      payload: CreateExpenseInput
      receipt?: QueuedReceipt
      /** Set once the Receipt reached Drive, so a failed POST does not upload it again. */
      uploadedFileId?: string
    })
  | (QueueItemBase & { kind: 'update'; payload: UpdateExpenseInput })
  | (QueueItemBase & { kind: 'delete'; payload: { id: string } })

/** The last read model the server answered, before the queue is laid over it. */
export type CachedReadModel = { key: 'readModel'; model: ReadModel; savedAt: number }

export type Setting = { key: string; value: string }

/** One cached Receipt thumbnail (spec "Receipt viewing": cached in Dexie keyed by file ID). */
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

export class ExpenseDb extends Dexie {
  queue!: Table<QueueItem, number>
  cache!: Table<CachedReadModel, string>
  settings!: Table<Setting, string>
  thumbnails!: Table<CachedThumbnail, string>

  /**
   * Settles once the old thumbnail database is gone (or was never there).
   * Not awaited by `open()`: a tab still running the old app would block
   * the delete, and that must not hold up the app.
   */
  legacyCleanup: Promise<void> = Promise.resolve()

  /**
   * Tests pass a unique name, fake-indexeddb's `indexedDB` / `IDBKeyRange`,
   * and a unique legacy thumbnail database name.
   */
  constructor(name: string = DB_NAME, options?: DexieOptions, legacyThumbnailDb: string = LEGACY_THUMBNAIL_DB_NAME) {
    super(name, options)
    let firstOpenAtV2 = false
    this.version(1).stores({
      queue: '++seq, expenseId, state',
      cache: 'key',
      settings: 'key',
    })
    this.version(2)
      .stores({ thumbnails: 'fileId, savedAt' })
      .upgrade(() => {
        firstOpenAtV2 = true
      })
    // A fresh install has no upgrade to run, but may still have the old one.
    this.on('populate', () => {
      firstOpenAtV2 = true
    })
    this.on('ready', () => {
      if (!firstOpenAtV2) return
      firstOpenAtV2 = false
      this.legacyCleanup = deleteDatabase((options?.indexedDB as IDBFactory | undefined) ?? globalThis.indexedDB, legacyThumbnailDb)
    })
  }
}

/** Deletes an IndexedDB database; never rejects (a missing one is a success). */
function deleteDatabase(idb: IDBFactory | undefined, name: string): Promise<void> {
  return new Promise((resolve) => {
    if (!idb) return resolve()
    try {
      const req = idb.deleteDatabase(name)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

let shared: ExpenseDb | null = null

/** The app's database, opened lazily on first use. */
export function appDb(): ExpenseDb {
  shared ??= new ExpenseDb()
  return shared
}
