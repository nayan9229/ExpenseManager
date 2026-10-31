import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test } from 'vitest'
import type { CreateExpenseInput, Expense, ReadModel } from './api'
import type { DeviceStore } from './device'
import { loadReadModel, readModelKey, saveExpense } from './readModel'

const model = {
  expenses: [],
  members: [{ memberId: 'admin', name: 'Admin', role: 'admin', defaultPaymentMethod: 'UPI', pinHash: null, avatarColor: '#6E7250' }],
  categories: [],
  recurringRules: [],
  ledgerUrl: 'https://docs.google.com/spreadsheets/d/s1',
  serverTime: '2026-10-31T12:00:00+05:30',
}

const report = { receiptsFolder: { created: false }, ledger: { created: false }, tabs: {}, seeded: {} }

function memoryStore(): DeviceStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

/** A fake server: records the calls and answers bootstrap and expenses. */
function fakeServer(expensesStatus = 200, expensesBody: unknown = model) {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith('/api/bootstrap')) return Response.json(report)
    if (url.endsWith('/api/expenses')) return Response.json(expensesBody, { status: expensesStatus })
    throw new Error(`unexpected request to ${url}`)
  }
  return { calls, fetchImpl }
}

describe('loadReadModel', () => {
  test('a fresh device runs Bootstrap once, then loads the read model', async () => {
    const store = memoryStore()
    const server = fakeServer()

    const first = await loadReadModel({ fetchImpl: server.fetchImpl, store })
    const second = await loadReadModel({ fetchImpl: server.fetchImpl, store })

    expect(first).toEqual(model)
    expect(second).toEqual(model)
    expect(server.calls).toEqual(['POST /api/bootstrap', 'GET /api/expenses', 'GET /api/expenses'])
  })

  test('a device that already bootstrapped goes straight to the read model', async () => {
    const store = memoryStore()
    store.setItem('fem.bootstrapped', '1')
    const server = fakeServer()

    await loadReadModel({ fetchImpl: server.fetchImpl, store })

    expect(server.calls).toEqual(['GET /api/expenses'])
  })

  test('a missing Ledger forgets the flag so the next load bootstraps again', async () => {
    const store = memoryStore()
    store.setItem('fem.bootstrapped', '1')
    const server = fakeServer(404, { code: 'LEDGER_NOT_FOUND', message: 'run Bootstrap' })

    await expect(loadReadModel({ fetchImpl: server.fetchImpl, store })).rejects.toMatchObject({ code: 'LEDGER_NOT_FOUND' })

    expect(store.getItem('fem.bootstrapped')).toBeNull()
  })
})

describe('saveExpense', () => {
  const input: CreateExpenseInput = {
    id: '6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10',
    expenseDate: '2026-10-30',
    loggedBy: 'admin',
    paidBy: 'admin',
    amount: 450,
    category: 'Other',
    merchantNote: '',
    paymentMethod: 'UPI',
    reimbursementStatus: 'none',
  }
  const stored: Expense = {
    ...input,
    createdAt: '2026-10-31T09:15:00+05:30',
    updatedAt: '2026-10-31T09:15:00+05:30',
    currency: 'INR',
    driveFileId: '',
    driveViewUrl: '',
    fileHash: '',
    status: 'active',
  }
  const older: Expense = { ...stored, id: 'older', expenseDate: '2026-10-29' }

  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const cached: ReadModel = { ...(model as ReadModel), expenses: [older] }
    client.setQueryData(readModelKey, cached)
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      if (init?.method === 'POST') return Response.json(stored, { status: 201 })
      return Response.json({ ...model, expenses: [stored, older] })
    }
    return { client, calls, fetchImpl }
  }

  test('the saved Expense is in the cached read model at once, newest first', async () => {
    const { client, fetchImpl } = setup()

    await saveExpense(input, { client, fetchImpl, refetch: false })

    const cached = client.getQueryData<ReadModel>(readModelKey)
    expect(cached?.expenses.map((e) => e.id)).toEqual([stored.id, 'older'])
  })

  test('a replayed save does not list the Expense twice', async () => {
    const { client, fetchImpl } = setup()

    await saveExpense(input, { client, fetchImpl, refetch: false })
    await saveExpense(input, { client, fetchImpl, refetch: false })

    const cached = client.getQueryData<ReadModel>(readModelKey)
    expect(cached?.expenses.map((e) => e.id)).toEqual([stored.id, 'older'])
  })

  test('marks the read model stale so the server copy is fetched again', async () => {
    const { client, fetchImpl } = setup()

    await saveExpense(input, { client, fetchImpl, refetch: false })

    expect(client.getQueryState(readModelKey)?.isInvalidated).toBe(true)
  })
})
