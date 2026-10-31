import { QueryClient } from '@tanstack/react-query'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import type { Expense, ReadModel } from './api'
import { ExpenseDb } from './db'
import { OfflineQueue } from './offlineQueue'
import { offlineQueueKey, readModelKey, removeExpense, saveEdit } from './readModel'

let dbCount = 0

const base: Expense = {
  id: 'a',
  createdAt: '2026-10-30T20:00:00+05:30',
  updatedAt: '2026-10-30T20:00:00+05:30',
  expenseDate: '2026-10-30',
  loggedBy: 'ramesh',
  paidBy: 'ramesh',
  amount: 450,
  currency: 'INR',
  category: 'Other',
  merchantNote: '',
  paymentMethod: 'UPI',
  driveFileId: '',
  driveViewUrl: '',
  fileHash: '',
  reimbursementStatus: 'none',
  status: 'active',
}
const a = base
const b: Expense = { ...base, id: 'b', expenseDate: '2026-10-29' }
const c: Expense = { ...base, id: 'c', expenseDate: '2026-10-28' }

const model: ReadModel = { expenses: [a, b, c], members: [], categories: [], recurringRules: [], ledgerUrl: '', serverTime: '' }

/** A cached read model (kept on the device too) and a fake server that answers PUT and DELETE with `answer`. */
async function setup(answer: { status: number; body: unknown }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(readModelKey, model)
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
    return Response.json(answer.body, { status: answer.status })
  }
  const queue = new OfflineQueue({ db: new ExpenseDb(`edit-${++dbCount}`, { indexedDB, IDBKeyRange }), fetchImpl, retryLater: () => {} })
  await queue.remember(model)
  const cached = () => client.getQueryData<ReadModel>(readModelKey)
  return { client, calls, queue, cached }
}

describe('saveEdit', () => {
  test('the edited Expense replaces its old copy at once, re-sorted newest first', async () => {
    const edited: Expense = { ...c, expenseDate: '2026-10-31', amount: 99, updatedAt: '2026-10-31T09:15:00+05:30' }
    const { client, queue, cached, calls } = await setup({ status: 200, body: edited })

    const result = await saveEdit({ id: 'c', expenseDate: '2026-10-31', amount: 99 }, { client, queue, refetch: false })

    expect(result).toEqual(edited)
    expect(calls).toEqual(['PUT /api/expenses'])
    expect(cached()?.expenses.map((e) => [e.id, e.amount])).toEqual([
      ['c', 99],
      ['a', 450],
      ['b', 450],
    ])
    expect(client.getQueryState(readModelKey)?.isInvalidated).toBe(true)
  })

  test('an Expense deleted on another phone leaves the list and the error is passed on', async () => {
    const { client, queue, cached } = await setup({ status: 404, body: { code: 'EXPENSE_NOT_FOUND', message: 'gone' } })

    await expect(saveEdit({ id: 'b', amount: 1 }, { client, queue, refetch: false })).rejects.toMatchObject({
      code: 'EXPENSE_NOT_FOUND',
    })
    expect(cached()?.expenses.map((e) => e.id)).toEqual(['a', 'c'])
  })

  test('any other failure leaves the cached copy as it was', async () => {
    const { client, queue, cached } = await setup({ status: 422, body: { code: 'INVALID_AMOUNT', message: 'no' } })

    await expect(saveEdit({ id: 'b', amount: 0 }, { client, queue, refetch: false })).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    })
    expect(cached()).toEqual(model)
  })
})

describe('removeExpense', () => {
  test('the deleted Expense leaves the cached list (and so every total) at once', async () => {
    const { client, queue, cached, calls } = await setup({ status: 200, body: { ...b, status: 'deleted' } })

    await removeExpense('b', { client, queue, refetch: false })

    expect(calls).toEqual(['DELETE /api/expenses?id=b'])
    expect(cached()?.expenses.map((e) => e.id)).toEqual(['a', 'c'])
    expect(client.getQueryState(readModelKey)?.isInvalidated).toBe(true)
  })

  test('an Expense already gone from the Ledger leaves the list too', async () => {
    const { client, queue, cached } = await setup({ status: 404, body: { code: 'EXPENSE_NOT_FOUND', message: 'gone' } })

    await removeExpense('b', { client, queue, refetch: false })

    expect(cached()?.expenses.map((e) => e.id)).toEqual(['a', 'c'])
  })

  test('a delete the server cannot take yet waits on the phone, and the Expense stays off the list', async () => {
    const { client, queue, cached } = await setup({ status: 502, body: { code: 'GOOGLE_ERROR', message: 'down' } })

    await removeExpense('b', { client, queue, refetch: false })

    expect(cached()?.expenses.map((e) => e.id)).toEqual(['a', 'c'])
    expect(client.getQueryData<{ kind: string; state: string }[]>(offlineQueueKey)?.map((i) => [i.kind, i.state])).toEqual([['delete', 'pending']])
  })
})
