/**
 * Admin Mode's data: one read model per selected month, cached beside the
 * default window under the same key prefix, so every save or edit that
 * invalidates the read model refreshes the month on screen too.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { getReadModel, isActive, type Expense, type ReadModel } from './api'
import { monthWindow, type Month } from './month'
import { isTransient, type OfflineQueue } from './offlineQueue'
import { appQueue, queryClient, readModelKey, saveEdit } from './readModel'

export const monthModelKey = (month: Month) => [...readModelKey, 'month', month] as const

/** Every pending Reimbursement, under the read model key so every save refreshes it. */
export const pendingModelKey = [...readModelKey, 'reimbursement', 'pending'] as const

const isPending = (e: Expense) => isActive(e) && e.reimbursementStatus === 'pending'

/**
 * The Reimbursable Queue's data: every active Expense still owed, however
 * old, with the Offline Queue laid over it. With no network (or a Google
 * hiccup) it falls back to the pending ones in the kept read model, which
 * covers the default window only: best effort. A definite refusal (401)
 * is passed on.
 */
export async function loadPendingReimbursements({ fetchImpl = fetch, queue = appQueue() }: { fetchImpl?: typeof fetch; queue?: OfflineQueue } = {}): Promise<ReadModel> {
  try {
    const model = await getReadModel(fetchImpl, { reimbursement: 'pending' })
    try {
      return await queue.layOver(model)
    } catch {
      return model
    }
  } catch (err) {
    if (!isTransient(err)) throw err
    const kept = await queue.readModel().catch(() => null)
    if (!kept) throw err
    return { ...kept, expenses: kept.expenses.filter(isPending) }
  }
}

/** The Reimbursable Queue's query. */
export function usePendingReimbursements() {
  return useQuery({ queryKey: pendingModelKey, queryFn: () => loadPendingReimbursements() })
}

/** The read model for exactly the days of `month` (IST). */
export function loadMonth(month: Month, fetchImpl: typeof fetch = fetch): Promise<ReadModel> {
  return getReadModel(fetchImpl, monthWindow(month))
}

/** The selected month's read model, kept on screen while the next month loads. */
export function useMonthModel(month: Month) {
  return useQuery({
    queryKey: monthModelKey(month),
    queryFn: () => loadMonth(month),
    placeholderData: (previous) => previous,
  })
}

type Deps = { client?: QueryClient; queue?: OfflineQueue; refetch?: boolean }

/**
 * "Mark done" on the Reimbursable Queue: an edit that sends only the ID and
 * Reimbursement `done`, through the Offline Queue (ticket 09). Every cached
 * window holding the Expense shows it done at once, also with no signal; a
 * refusal changes nothing and is passed on.
 */
export async function markPaidBack(expense: Expense, deps: Deps = {}): Promise<Expense> {
  const client = deps.client ?? queryClient
  const stored = await saveEdit({ id: expense.id, reimbursementStatus: 'done' }, { ...deps, client, base: expense })
  client.setQueriesData<ReadModel>({ queryKey: readModelKey }, (old) =>
    old && old.expenses.some((e) => e.id === stored.id)
      ? { ...old, expenses: old.expenses.map((e) => (e.id === stored.id ? stored : e)) }
      : old,
  )
  return stored
}
