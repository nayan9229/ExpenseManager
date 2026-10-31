/**
 * The Offline Queue and Sync (GLOSSARY; spec "Offline Queue and Sync").
 *
 * Every save, edit and delete is written here first, then sent. The list a
 * screen shows is the last read model the server answered with the queue
 * laid over it, so a queued Expense is listed at once, and taking an item
 * out of the queue (Discard) takes its change off the list too.
 *
 * Sync replays the queue oldest first. Transient failures (no answer, 5xx,
 * 429) keep the item and retry later, for ever; any other refusal marks it
 * "needs attention" until the Member taps Retry or Discard. Creates carry
 * the device-made ID, so replaying one whose answer was lost gets the
 * stored row back (200) instead of a second row.
 */
import { ApiError, createExpense, deleteExpense, updateExpense, type CreateExpenseInput, type Expense, type ReadModel, type UpdateExpenseInput } from './api'
import type { ExpenseDb, QueueError, QueueItem, QueueState, QueuedReceipt } from './db'
import { byNewest } from './quickExpense'
import { uploadReceipt, type PutFile } from './upload'

/** What a screen asks to save. */
export type QueueRequest =
  | { kind: 'create'; payload: CreateExpenseInput; receipt?: QueuedReceipt }
  | { kind: 'update'; payload: UpdateExpenseInput }
  | { kind: 'delete'; id: string }

/**
 * What a save resolved to: the Expense to show (null for a delete, or an
 * edit of an Expense outside the loaded window), and whether the change is
 * still waiting on the phone.
 */
export type Saved = { expense: Expense | null; queued: boolean }

export type OfflineQueueDeps = {
  db: ExpenseDb
  fetchImpl?: typeof fetch
  now?: () => Date
  /** The Drive PUT and the wait between upload tries (tests pass fakes). */
  put?: PutFile
  sleep?: (ms: number) => Promise<void>
  /** Called after every Sync run, e.g. to refresh what the screens show. */
  onSynced?: (report: SyncReport) => void
  /** How long Save waits for the server before saying "Saved on phone" (default SAVE_WAIT_MS). */
  saveWaitMs?: number
  /** True when the browser knows it has no network (`navigator.onLine` false): Save does not wait then. */
  isOffline?: () => boolean
  /** Asks for another Sync run in `ms`; the default keeps one browser timer. Tests record the waits. */
  retryLater?: (ms: number, run: () => void) => void
}

/**
 * How long Save waits for the server before it says "Saved on phone" and
 * lets the Member go (spec: Save succeeds instantly). A refusal that
 * arrives later is not lost: the item turns "Needs attention" with the
 * server's message (retryChoice says what Retry does).
 */
export const SAVE_WAIT_MS = 1_500

/**
 * What Retry does for a refused item: a 409 DUPLICATE_RECEIPT is sent again
 * with `force` ("Add anyway"); anything else is sent as it is.
 */
export function retryChoice(item: QueueItem): { label: 'Add anyway' | 'Retry'; force: boolean } {
  return item.lastError?.code === 'DUPLICATE_RECEIPT' ? { label: 'Add anyway', force: true } : { label: 'Retry', force: false }
}

/** Wait before the next automatic try after `attempts` failed ones: 2 s doubling, at most 5 minutes. */
export function retryDelay(attempts: number): number {
  return Math.min(2_000 * 2 ** Math.max(0, attempts - 1), 300_000)
}

let timer: ReturnType<typeof setTimeout> | undefined
const browserRetry = (ms: number, run: () => void) => {
  clearTimeout(timer)
  timer = setTimeout(run, ms)
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

/** RFC 3339 in IST, the way the server stamps rows. */
export function istTimestamp(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19) + '+05:30'
}

/** The Expense a queued create stands for until the server's copy arrives. */
function optimisticExpense(payload: CreateExpenseInput, receipt: QueuedReceipt | undefined, queuedAt: string): Expense {
  return {
    id: payload.id,
    createdAt: queuedAt,
    updatedAt: queuedAt,
    expenseDate: payload.expenseDate,
    loggedBy: payload.loggedBy,
    paidBy: payload.paidBy || payload.loggedBy,
    amount: payload.amount,
    currency: 'INR',
    category: payload.category,
    merchantNote: payload.merchantNote,
    paymentMethod: payload.paymentMethod,
    driveFileId: '',
    driveViewUrl: '',
    fileHash: receipt?.fileHash ?? payload.fileHash ?? '',
    reimbursementStatus: payload.reimbursementStatus ?? 'none',
    status: 'active',
    receiptNumber: payload.receiptNumber ?? '',
  }
}

function upsert(model: ReadModel, expense: Expense): ReadModel {
  return { ...model, expenses: [expense, ...model.expenses.filter((e) => e.id !== expense.id)].sort(byNewest) }
}

/** Per Expense ID: `pending` while a change waits, `needs-attention` when any of its changes was refused. */
export function waitingStates(items: QueueItem[]): Map<string, QueueState> {
  const states = new Map<string, QueueState>()
  for (const item of items) {
    if (states.get(item.expenseId) !== 'needs-attention') states.set(item.expenseId, item.state)
  }
  return states
}

/**
 * Whether a failure may pass by itself: no answer at all, a server or
 * Google hiccup (5xx), or too many requests (429). Any other 4xx is a
 * definite answer that sending again will not change.
 */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true
  return err.status >= 500 || err.status === 429 || err.status === 408
}

/**
 * The oldest pending item whose Expense has nothing older that needs
 * attention: one refused item holds back only the later changes to the
 * same Expense, never the rest of the queue.
 */
function nextToSend(items: QueueItem[]): QueueItem | undefined {
  const held = new Set<string>()
  for (const item of items) {
    if (item.state === 'needs-attention') held.add(item.expenseId)
    else if (!held.has(item.expenseId)) return item
  }
  return undefined
}

/** A new queue entry for `request`, stamped `queuedAt`. */
function toItem(request: QueueRequest, queuedAt: string): QueueItem {
  const base = { queuedAt, attempts: 0, lastError: null, state: 'pending' as const }
  switch (request.kind) {
    case 'create':
      return { ...base, kind: 'create', payload: request.payload, expenseId: request.payload.id, ...(request.receipt ? { receipt: request.receipt } : {}) }
    case 'update':
      return { ...base, kind: 'update', payload: request.payload, expenseId: request.payload.id }
    case 'delete':
      return { ...base, kind: 'delete', payload: { id: request.id }, expenseId: request.id }
  }
}

/** `model` as it looks once `item` has reached the server. */
function overlay(model: ReadModel, item: QueueItem): ReadModel {
  switch (item.kind) {
    case 'create':
      return upsert(model, optimisticExpense(item.payload, item.receipt, item.queuedAt))
    case 'update': {
      const current = model.expenses.find((e) => e.id === item.expenseId)
      // Outside the loaded window: nothing on screen to change.
      if (!current) return model
      const { id: _id, ...fields } = item.payload
      return upsert(model, { ...current, ...fields, updatedAt: item.queuedAt })
    }
    case 'delete':
      return { ...model, expenses: model.expenses.filter((e) => e.id !== item.expenseId) }
  }
}

function toQueueError(err: unknown): QueueError {
  if (err instanceof ApiError) return { status: err.status, code: err.code, message: err.message, body: err.body }
  return { status: 0, code: 'NETWORK', message: err instanceof Error ? err.message : 'No answer from the server' }
}

export class OfflineQueue {
  private readonly db: ExpenseDb
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date
  private readonly retryLater: (ms: number, run: () => void) => void
  private readonly put: PutFile | undefined
  private readonly sleep: ((ms: number) => Promise<void>) | undefined
  private readonly saveWaitMs: number
  private readonly isOffline: () => boolean
  private readonly onSynced: ((report: SyncReport) => void) | undefined

  constructor({
    db,
    fetchImpl = (...args) => fetch(...args),
    now = () => new Date(),
    retryLater = browserRetry,
    put,
    sleep,
    saveWaitMs = SAVE_WAIT_MS,
    isOffline = () => globalThis.navigator?.onLine === false,
    onSynced,
  }: OfflineQueueDeps) {
    this.db = db
    this.onSynced = onSynced
    this.saveWaitMs = saveWaitMs
    this.isOffline = isOffline
    this.put = put
    this.sleep = sleep
    this.fetchImpl = fetchImpl
    this.now = now
    this.retryLater = retryLater
  }

  /** Keeps the read model the server just answered, for the next start with no network. */
  async remember(model: ReadModel): Promise<void> {
    await this.db.cache.put({ key: 'readModel', model, savedAt: this.now().getTime() })
  }

  /** When the kept read model was loaded (ms since epoch), or null when none is kept. */
  async rememberedAt(): Promise<number | null> {
    return (await this.db.cache.get('readModel'))?.savedAt ?? null
  }

  /** Every queued item, oldest first. */
  async items(): Promise<QueueItem[]> {
    return this.db.queue.orderBy('seq').toArray()
  }

  /** The last server read model with every queued change laid over it, or null before the first load. */
  async readModel(): Promise<ReadModel | null> {
    const cached = await this.db.cache.get('readModel')
    if (!cached) return null
    return this.layOver(cached.model)
  }

  /** Any read model (a month, the pending Reimbursements) as it looks with every queued change applied. */
  async layOver(model: ReadModel): Promise<ReadModel> {
    return (await this.items()).reduce(overlay, model)
  }

  /** Which Expenses have a change still on the phone, and whether one of them needs attention. */
  async waiting(): Promise<Map<string, QueueState>> {
    return waitingStates(await this.items())
  }

  /** Writes the change to the queue, then runs Sync and reports what became of it. */
  async save(request: QueueRequest): Promise<Saved> {
    const item = toItem(request, istTimestamp(this.now()))
    const seq = await this.db.queue.add(item)
    this.watched.add(seq)
    const run = this.sync()
    if (this.isOffline()) {
      void run
    } else {
      let timeout: ReturnType<typeof setTimeout> | undefined
      await Promise.race([run, new Promise<void>((resolve) => (timeout = setTimeout(resolve, this.saveWaitMs)))])
      clearTimeout(timeout)
    }
    const outcome = this.outcomes.get(seq)
    this.watched.delete(seq)
    this.outcomes.delete(seq)
    if (outcome?.kind === 'refused') {
      // The screen is still open: hand the refusal back to it (the draft is
      // kept, a fix and Save again replays the same ID) rather than leave it
      // waiting in the queue.
      await this.discard(seq)
      throw outcome.cause
    }
    if (outcome?.kind === 'done' && outcome.gone) throw outcome.gone
    if (outcome?.kind === 'done') return { expense: request.kind === 'delete' ? null : (outcome.expense ?? null), queued: false }
    const shown = request.kind === 'delete' ? undefined : (await this.readModel())?.expenses.find((e) => e.id === item.expenseId)
    return { expense: shown ?? (item.kind === 'create' ? optimisticExpense(item.payload, item.receipt, item.queuedAt) : null), queued: true }
  }

  /**
   * Sends a refused item again (Retry). `force` saves past a 409
   * DUPLICATE_RECEIPT ("Add anyway"). Resolves when that Sync run ends.
   */
  async retry(seq: number, { force = false } = {}): Promise<SyncReport> {
    const item = await this.db.queue.get(seq)
    if (item) {
      const changes: Partial<QueueItem> = { state: 'pending' }
      if (item.kind === 'create') {
        if (force) Object.assign(changes, { payload: { ...item.payload, force: true } })
        // The uploaded file left the Receipt Store: upload the kept copy again.
        if (item.lastError?.code === 'RECEIPT_NOT_IN_STORE') Object.assign(changes, { uploadedFileId: undefined })
      }
      await this.db.queue.update(seq, changes)
    }
    return this.sync()
  }

  /**
   * Drops an item from the queue (Discard), which takes its change off the
   * list. Discarding a create also drops the later edits and delete of that
   * Expense: they could only fail once it never existed.
   */
  async discard(seq: number): Promise<void> {
    await this.db.transaction('rw', this.db.queue, async () => {
      const item = await this.db.queue.get(seq)
      if (!item) return
      await this.db.queue.delete(seq)
      if (item.kind === 'create') await this.db.queue.where('expenseId').equals(item.expenseId).and((i) => (i.seq ?? 0) > seq).delete()
    })
  }

  /** Items an open screen is waiting on, and what became of them. */
  private readonly watched = new Set<number>()
  private readonly outcomes = new Map<number, Outcome>()
  private running: Promise<SyncReport> | null = null
  private again = false

  /**
   * Replays the queue, oldest first. Safe to call at any time and as often
   * as wanted: a call during a run joins it (and makes it look once more).
   */
  sync(): Promise<SyncReport> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      let report: SyncReport
      do {
        this.again = false
        report = await this.drain()
      } while (this.again)
      this.onSynced?.(report)
      return report
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async drain(): Promise<SyncReport> {
    let synced = 0
    let unpaired = false
    for (;;) {
      const next = nextToSend(await this.items())
      if (!next || next.seq === undefined) break
      const outcome = await this.send(next)
      if (this.watched.has(next.seq)) this.outcomes.set(next.seq, outcome)
      if (outcome.kind === 'done') {
        await this.settle(next.seq, outcome)
        synced++
        continue
      }
      const attempts = next.attempts + 1
      if (outcome.kind === 'unpaired') {
        // Not this item's fault: it waits for the phone to be paired again.
        await this.db.queue.update(next.seq, { lastError: outcome.error })
        unpaired = true
        break
      }
      if (outcome.kind === 'refused') {
        await this.db.queue.update(next.seq, { attempts, lastError: outcome.error, state: 'needs-attention' })
        continue
      }
      await this.db.queue.update(next.seq, { attempts, lastError: outcome.error })
      this.retryLater(retryDelay(attempts), () => void this.sync())
      break
    }
    return { synced, remaining: await this.db.queue.count(), unpaired }
  }

  /** One request (or, for a create with a Receipt, the upload and then the request). */
  private async send(item: QueueItem): Promise<Outcome> {
    try {
      if (item.kind === 'create') {
        const { expense } = await createExpense(await this.withReceipt(item), this.fetchImpl)
        return { kind: 'done', expense }
      }
      if (item.kind === 'update') return { kind: 'done', expense: await updateExpense(item.payload, this.fetchImpl) }
      await deleteExpense(item.payload.id, this.fetchImpl)
      return { kind: 'done', removed: item.payload.id }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EXPENSE_NOT_FOUND' && item.kind !== 'create') {
        // Deleted on another phone: a delete is done; an edit has nothing
        // left to change, so it is dropped together with the Expense.
        return { kind: 'done', removed: item.expenseId, ...(item.kind === 'update' ? { gone: err } : {}) }
      }
      const error = toQueueError(err)
      if (err instanceof ApiError && err.status === 401) return { kind: 'unpaired', error }
      return isTransient(err) ? { kind: 'transient', error } : { kind: 'refused', error, cause: err }
    }
  }

  /**
   * The create to send. A Receipt kept on the phone is uploaded first
   * (pipeline steps 4 and 5: a fresh session, one PUT, retried from scratch),
   * and OCR is skipped so the fields the Member typed stay as they are. The
   * file ID is written down at once, so a failed POST never uploads twice.
   */
  private async withReceipt(item: Extract<QueueItem, { kind: 'create' }>): Promise<CreateExpenseInput> {
    if (!item.receipt) return item.payload
    let fileId = item.uploadedFileId
    if (!fileId) {
      const { blob, mimeType, ext } = item.receipt
      const uploaded = await uploadReceipt(
        { blob, name: `${item.payload.id}.${ext}`, mimeType, expenseDate: item.payload.expenseDate },
        { fetchImpl: this.fetchImpl, ...(this.put ? { put: this.put } : {}), ...(this.sleep ? { sleep: this.sleep } : {}) },
      )
      fileId = uploaded.fileId
      const id = fileId
      if (item.seq !== undefined) await this.db.queue.update(item.seq, (stored) => void (stored.kind === 'create' && (stored.uploadedFileId = id)))
    }
    return { ...item.payload, driveFileId: fileId, fileHash: item.receipt.fileHash }
  }

  /** Takes a sent item out of the queue and puts the server's answer into the kept read model, together. */
  private async settle(seq: number, { expense, removed }: Done): Promise<void> {
    await this.db.transaction('rw', this.db.queue, this.db.cache, async () => {
      await this.db.queue.delete(seq)
      const cached = await this.db.cache.get('readModel')
      if (!cached) return
      let model = cached.model
      if (expense) model = upsert(model, expense)
      if (removed) model = { ...model, expenses: model.expenses.filter((e) => e.id !== removed) }
      await this.db.cache.put({ ...cached, model })
    })
  }
}

/** A sent item: the server's copy to keep, or the ID of an Expense to drop (`gone`: the edit found it deleted). */
type Done = { kind: 'done'; expense?: Expense; removed?: string; gone?: ApiError }

type Outcome =
  | Done
  /** Worth trying again later by itself. */
  | { kind: 'transient'; error: QueueError }
  /** Refused for good: waits for the Member. */
  | { kind: 'refused'; error: QueueError; cause: unknown }
  /** The Session is gone (401): everything waits for pairing. */
  | { kind: 'unpaired'; error: QueueError }

/** What one Sync run achieved. */
export type SyncReport = {
  /** Items the server accepted in this run. */
  synced: number
  /** Items still on the phone. */
  remaining: number
  /** The server answered 401: the phone must be paired again before anything syncs. */
  unpaired: boolean
}
