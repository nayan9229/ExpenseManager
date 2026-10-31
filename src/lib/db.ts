/**
 * The device's own database (Dexie over IndexedDB): the Offline Queue, the
 * last read model the server sent, and the device settings. Receipt
 * thumbnails live in their own small database (ticket 08), not here.
 *
 * Schema changes add a new `version(n)` block; never edit an old one.
 */
import Dexie, { type DexieOptions, type Table } from 'dexie'
import type { CreateExpenseInput, ReadModel, UpdateExpenseInput } from './api'

export const DB_NAME = 'family-expenses'

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

export class ExpenseDb extends Dexie {
  queue!: Table<QueueItem, number>
  cache!: Table<CachedReadModel, string>
  settings!: Table<Setting, string>

  /** Tests pass a unique name and fake-indexeddb's `indexedDB` / `IDBKeyRange`. */
  constructor(name: string = DB_NAME, options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({
      queue: '++seq, expenseId, state',
      cache: 'key',
      settings: 'key',
    })
  }
}

let shared: ExpenseDb | null = null

/** The app's database, opened lazily on first use. */
export function appDb(): ExpenseDb {
  shared ??= new ExpenseDb()
  return shared
}
