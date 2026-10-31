/**
 * The read model: everything a device needs after pairing, loaded through
 * TanStack Query so every screen shares one cached copy and one refetch.
 *
 * Bootstrap (GLOSSARY) runs once per device before the first load; the
 * flag lives in device memory so a reinstall runs it again, which is
 * harmless because Bootstrap is idempotent.
 */
import { QueryClient, useQuery } from '@tanstack/react-query'
import {
  ApiError,
  getReadModel,
  runBootstrap,
  type CreateExpenseInput,
  type Expense,
  type ReadModel,
  type UpdateExpenseInput,
} from './api'
import { appDb, type QueueItem, type QueuedReceipt } from './db'
import { forgetBootstrapped, isBootstrapped, markBootstrapped, type DeviceStore } from './device'
import { OfflineQueue, type QueueRequest, type Saved } from './offlineQueue'
import { byNewest } from './quickExpense'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // Retry when the network dropped or Google hiccupped, never for a
      // definite answer such as NOT_PAIRED or SERVER_MISCONFIGURED.
      retry: (failureCount, error) => failureCount < 2 && (!(error instanceof ApiError) || error.status >= 502),
    },
  },
})

export const readModelKey = ['readModel'] as const

/** The Offline Queue items, oldest first, for badges and the "Needs attention" list. */
export const offlineQueueKey = ['offlineQueue'] as const

let shared: OfflineQueue | null = null

/** The app's Offline Queue on the device database. */
export function appQueue(): OfflineQueue {
  shared ??= new OfflineQueue({
    db: appDb(),
    onSynced: (report) => {
      void showQueue().catch(() => {})
      if (report.synced > 0) void queryClient.invalidateQueries({ queryKey: readModelKey })
    },
  })
  return shared
}

type Deps = {
  fetchImpl?: typeof fetch
  /** Undefined means the device settings; null means no memory at all. */
  store?: DeviceStore | null
  /** Where the loaded read model is kept for a start with no network; null keeps nothing. */
  queue?: OfflineQueue | null
}

/**
 * Runs Bootstrap if this device never has, then loads the read model, keeps
 * it on the device, and returns it with the Offline Queue laid over it. A
 * successful load proves the network works, so Sync is started too.
 */
export async function loadReadModel({ fetchImpl = fetch, store, queue = appQueue() }: Deps = {}): Promise<ReadModel> {
  if (!isBootstrapped(store)) {
    await runBootstrap(fetchImpl)
    markBootstrapped(store)
  }
  let model: ReadModel
  try {
    model = await getReadModel(fetchImpl)
  } catch (err) {
    if (err instanceof ApiError && err.code === 'LEDGER_NOT_FOUND') {
      // The Ledger went missing after this device bootstrapped (deleted by
      // hand, or the folder changed): Bootstrap again on the next load.
      forgetBootstrapped(store)
    }
    throw err
  }
  if (!queue) return model
  try {
    await queue.remember(model)
    const shown = (await queue.readModel()) ?? model
    void queue.sync()
    return shown
  } catch {
    // IndexedDB refused: show the server copy, keep nothing.
    return model
  }
}

/**
 * Puts the kept read model (with the queue over it) into the query cache
 * before the first screen renders, so the app opens with no network. It
 * keeps the time it was loaded, so it is refetched as soon as it is stale.
 * Resolves true when there was something to show.
 */
export async function showKeptReadModel(client: QueryClient = queryClient, queue: OfflineQueue = appQueue()): Promise<boolean> {
  try {
    const [model, items, savedAt] = await Promise.all([queue.readModel(), queue.items(), queue.rememberedAt()])
    client.setQueryData(offlineQueueKey, items)
    if (!model) return false
    client.setQueryData(readModelKey, model, { updatedAt: savedAt ?? 0 })
    return true
  } catch {
    return false
  }
}

/** Copies the queue and the read model it changes into the query cache, keeping the read model's load time. */
export async function showQueue(client: QueryClient = queryClient, queue: OfflineQueue = appQueue()): Promise<void> {
  const [model, items] = await Promise.all([queue.readModel(), queue.items()])
  client.setQueryData(offlineQueueKey, items)
  if (model) client.setQueryData(readModelKey, model, { updatedAt: client.getQueryState(readModelKey)?.dataUpdatedAt ?? 0 })
}

/** The shared read model query. */
export function useReadModel() {
  return useQuery({ queryKey: readModelKey, queryFn: () => loadReadModel() })
}

/** The Offline Queue as the screens see it (filled by `showQueue`, never fetched). */
export function useOfflineQueue(): QueueItem[] {
  const { data } = useQuery({
    queryKey: offlineQueueKey,
    queryFn: () => appQueue().items(),
    staleTime: Infinity,
    networkMode: 'always',
  })
  return data ?? []
}

/** The read model with `expense` added (or replacing the copy with its ID), newest first. */
export function withExpense(model: ReadModel, expense: Expense): ReadModel {
  const expenses = [expense, ...model.expenses.filter((e) => e.id !== expense.id)].sort(byNewest)
  return { ...model, expenses }
}

/** The read model without the Expense whose ID is `id`. */
export function withoutExpense(model: ReadModel, id: string): ReadModel {
  return { ...model, expenses: model.expenses.filter((e) => e.id !== id) }
}

type SaveDeps = {
  client?: QueryClient
  queue?: OfflineQueue
  /** Refetch the server copy once the change reached it (default). Tests turn it off. */
  refetch?: boolean
}

/**
 * Runs one save through the Offline Queue: the change is on the phone (and
 * on screen) before any network, then Sync sends it. The query cache is
 * brought up to date whatever happened; a refusal is passed on.
 */
async function throughQueue(request: QueueRequest, { client = queryClient, queue = appQueue(), refetch = true }: SaveDeps): Promise<Saved> {
  let saved: Saved | undefined
  try {
    saved = await queue.save(request)
    return saved
  } finally {
    await showQueue(client, queue).catch(() => {})
    if (saved && !saved.queued) void client.invalidateQueries({ queryKey: readModelKey, refetchType: refetch ? 'active' : 'none' })
  }
}

/** A saved create: the Expense to show, and whether it is still waiting on the phone. */
export type SavedExpense = { expense: Expense; queued: boolean }

/**
 * Saves a new Expense (with a Receipt kept on the phone, when the upload
 * could not happen). With signal it waits for the server; with none it
 * resolves at once with `queued: true` ("Saved on phone, will sync when
 * online"). A definite refusal rejects with the ApiError and leaves
 * nothing queued, so the screen keeps the draft and its ID.
 */
export async function saveExpense(
  input: CreateExpenseInput,
  { receipt, ...deps }: SaveDeps & { receipt?: QueuedReceipt } = {},
): Promise<SavedExpense> {
  const saved = await throughQueue({ kind: 'create', payload: input, ...(receipt ? { receipt } : {}) }, deps)
  return { expense: saved.expense ?? (input as unknown as Expense), queued: saved.queued }
}

/**
 * Edits an Expense through the Offline Queue and returns it as it now
 * looks. An Expense deleted on another device (404) is dropped from the
 * list before the error is passed on; any other refusal leaves the list
 * as it was. `base` is the Expense being edited, for one outside the window.
 */
export async function saveEdit(input: UpdateExpenseInput, { base, ...deps }: SaveDeps & { base?: Expense } = {}): Promise<Expense> {
  const saved = await throughQueue({ kind: 'update', payload: input }, deps)
  return saved.expense ?? ({ ...base, ...input } as Expense)
}

/**
 * Deletes an Expense (Soft Delete) through the Offline Queue; it leaves
 * the list at once. One already gone from the Ledger counts as deleted.
 */
export async function removeExpense(id: string, deps: SaveDeps = {}): Promise<void> {
  await throughQueue({ kind: 'delete', id }, deps)
}

/** Retry for a "Needs attention" item; `force` is "Add anyway" for a duplicate Receipt. */
export async function retryQueued(seq: number, { force = false, client = queryClient, queue = appQueue() }: { force?: boolean } & SaveDeps = {}): Promise<void> {
  const run = queue.retry(seq, { force })
  await showQueue(client, queue).catch(() => {})
  const report = await run
  await showQueue(client, queue).catch(() => {})
  if (report.synced > 0) void client.invalidateQueries({ queryKey: readModelKey })
}

/** Discard for a "Needs attention" item: its change leaves the list. */
export async function discardQueued(seq: number, { client = queryClient, queue = appQueue() }: SaveDeps = {}): Promise<void> {
  await queue.discard(seq)
  await showQueue(client, queue).catch(() => {})
}
