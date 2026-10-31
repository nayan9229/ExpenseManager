import { QueryClient } from '@tanstack/react-query'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import type { Expense, ReadModel } from './api'
import { loadMonth, markPaidBack, monthModelKey } from './adminData'
import { ExpenseDb } from './db'
import { OfflineQueue } from './offlineQueue'
import { readModelKey } from './readModel'

let dbCount = 0
const queueFor = (fetchImpl: typeof fetch) =>
  new OfflineQueue({ db: new ExpenseDb(`admin-${++dbCount}`, { indexedDB, IDBKeyRange }), fetchImpl, retryLater: () => {} })

const pending: Expense = {
  id: 'p',
  createdAt: '2026-10-12T10:00:00+05:30',
  updatedAt: '2026-10-12T10:00:00+05:30',
  expenseDate: '2026-10-12',
  loggedBy: 'kid1',
  paidBy: 'kid1',
  amount: 120,
  currency: 'INR',
  category: 'School & Kids',
  merchantNote: 'notebooks',
  paymentMethod: 'Cash',
  driveFileId: '',
  driveViewUrl: '',
  fileHash: '',
  reimbursementStatus: 'pending',
  status: 'active',
}
const model = (expenses: Expense[]): ReadModel => ({ expenses, members: [], categories: [], recurringRules: [], ledgerUrl: '', serverTime: '' })

describe('loadMonth', () => {
  test('asks the expenses function for exactly the days of the month', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url))
      return Response.json(model([pending]))
    }
    const result = await loadMonth('2026-02', fetchImpl)
    expect(urls).toEqual(['/api/expenses?from=2026-02-01&to=2026-02-28'])
    expect(result.expenses).toEqual([pending])
  })

  test('the month query sits under the read model key, so every save refreshes it', () => {
    expect(monthModelKey('2026-10').slice(0, readModelKey.length)).toEqual([...readModelKey])
  })
})

describe('markPaidBack', () => {
  test('sends only the ID and Reimbursement done, and every cached window shows it at once', async () => {
    const done: Expense = { ...pending, reimbursementStatus: 'done', updatedAt: '2026-10-31T09:15:00+05:30' }
    const bodies: unknown[] = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push({ method: init?.method, body: JSON.parse(String(init?.body)) })
      return Response.json(done)
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(readModelKey, model([pending]))
    client.setQueryData(monthModelKey('2026-10'), model([pending]))
    client.setQueryData(monthModelKey('2026-09'), model([]))

    await markPaidBack(pending, { client, queue: queueFor(fetchImpl), refetch: false })

    expect(bodies).toEqual([{ method: 'PUT', body: { id: 'p', reimbursementStatus: 'done' } }])
    expect(client.getQueryData<ReadModel>(readModelKey)?.expenses[0]?.reimbursementStatus).toBe('done')
    expect(client.getQueryData<ReadModel>(monthModelKey('2026-10'))?.expenses[0]?.reimbursementStatus).toBe('done')
    expect(client.getQueryData<ReadModel>(monthModelKey('2026-09'))?.expenses).toEqual([])
  })

  test('a refusal leaves the month as it was and is passed on', async () => {
    const fetchImpl: typeof fetch = async () => Response.json({ code: 'INVALID_REIMBURSEMENT', message: 'no' }, { status: 422 })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(monthModelKey('2026-10'), model([pending]))

    await expect(markPaidBack(pending, { client, queue: queueFor(fetchImpl), refetch: false })).rejects.toMatchObject({
      code: 'INVALID_REIMBURSEMENT',
    })
    expect(client.getQueryData<ReadModel>(monthModelKey('2026-10'))?.expenses[0]?.reimbursementStatus).toBe('pending')
  })

  test('with no signal the month shows it done at once and the edit waits on the phone', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    const queue = queueFor(fetchImpl)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(monthModelKey('2026-10'), model([pending]))

    const shown = await markPaidBack(pending, { client, queue, refetch: false })

    expect(shown).toMatchObject({ id: 'p', amount: 120, reimbursementStatus: 'done' })
    expect(client.getQueryData<ReadModel>(monthModelKey('2026-10'))?.expenses[0]).toMatchObject({ amount: 120, reimbursementStatus: 'done' })
    expect((await queue.items()).map((i) => [i.kind, i.state])).toEqual([['update', 'pending']])
  })
})
