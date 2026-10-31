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
  createExpense,
  getReadModel,
  runBootstrap,
  type CreateExpenseInput,
  type CreateExpenseResult,
  type Expense,
  type ReadModel,
} from './api'
import { forgetBootstrapped, isBootstrapped, markBootstrapped, type DeviceStore } from './device'
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

type Deps = {
  fetchImpl?: typeof fetch
  /** Undefined means the browser's localStorage; null means no memory at all. */
  store?: DeviceStore | null
}

/** Runs Bootstrap if this device never has, then loads the read model. */
export async function loadReadModel({ fetchImpl = fetch, store }: Deps = {}): Promise<ReadModel> {
  if (!isBootstrapped(store)) {
    await runBootstrap(fetchImpl)
    markBootstrapped(store)
  }
  try {
    return await getReadModel(fetchImpl)
  } catch (err) {
    if (err instanceof ApiError && err.code === 'LEDGER_NOT_FOUND') {
      // The Ledger went missing after this device bootstrapped (deleted by
      // hand, or the folder changed): Bootstrap again on the next load.
      forgetBootstrapped(store)
    }
    throw err
  }
}

/** The shared read model query. */
export function useReadModel() {
  return useQuery({ queryKey: readModelKey, queryFn: () => loadReadModel() })
}

/** The read model with `expense` added (or replacing the copy with its ID), newest first. */
export function withExpense(model: ReadModel, expense: Expense): ReadModel {
  const expenses = [expense, ...model.expenses.filter((e) => e.id !== expense.id)].sort(byNewest)
  return { ...model, expenses }
}

type SaveDeps = {
  client?: QueryClient
  fetchImpl?: typeof fetch
  /** Refetch the server copy straight away (default). Tests turn it off. */
  refetch?: boolean
}

/**
 * Creates an Expense, puts it in the cached read model at once so the list
 * shows it without a reload, then marks the read model stale so the server
 * copy replaces the optimistic one. Rejects with the ApiError on failure;
 * the caller keeps the draft (and its ID) so a retry is an idempotent replay.
 */
export async function saveExpense(
  input: CreateExpenseInput,
  { client = queryClient, fetchImpl = fetch, refetch = true }: SaveDeps = {},
): Promise<CreateExpenseResult> {
  const result = await createExpense(input, fetchImpl)
  client.setQueryData<ReadModel>(readModelKey, (old) => (old ? withExpense(old, result.expense) : old))
  // Not awaited: Save is done once the server answered; the refetch runs
  // in the background and a failure there keeps the optimistic copy.
  void client.invalidateQueries({ queryKey: readModelKey, refetchType: refetch ? 'active' : 'none' })
  return result
}
