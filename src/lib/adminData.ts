/**
 * Admin Mode's data: one read model per selected month, cached beside the
 * default window under the same key prefix, so every save or edit that
 * invalidates the read model refreshes the month on screen too.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { getReadModel, type Expense, type ReadModel } from './api'
import { monthWindow, type Month } from './month'
import type { OfflineQueue } from './offlineQueue'
import { queryClient, readModelKey, saveEdit } from './readModel'

export const monthModelKey = (month: Month) => [...readModelKey, 'month', month] as const

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
