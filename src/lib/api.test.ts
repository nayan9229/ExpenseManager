import { describe, expect, test } from 'vitest'
import { ApiError, createExpense, getReadModel, getSessionState, pairDevice, runBootstrap, type CreateExpenseInput, type Expense } from './api'

type Seen = { method: string; body: string | null; contentType: string | null }

/** A fake `fetch` for /api/pair that records the one request it receives. */
function fakeAuth(status: number, body: unknown, seen: Seen[] = []): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.endsWith('/api/pair')) throw new Error(`unexpected request to ${url}`)
    const headers = new Headers(init?.headers)
    seen.push({
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
      contentType: headers.get('Content-Type'),
    })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}

describe('getSessionState', () => {
  test('reports an unpaired device from the pair GET', async () => {
    const state = await getSessionState(fakeAuth(200, { paired: false }))
    expect(state).toEqual({ paired: false })
  })

  test('reports a paired device from the pair GET', async () => {
    const state = await getSessionState(fakeAuth(200, { paired: true }))
    expect(state).toEqual({ paired: true })
  })

  test('surfaces the server error envelope as an ApiError', async () => {
    const call = getSessionState(fakeAuth(500, { code: 'BOOM', message: 'it broke' }))
    await expect(call).rejects.toMatchObject({ code: 'BOOM', message: 'it broke', status: 500 })
    await expect(call).rejects.toBeInstanceOf(ApiError)
  })
})

describe('pairDevice', () => {
  test('posts the Access Code as JSON and reports the device paired', async () => {
    const seen: Seen[] = []

    const state = await pairDevice('correct-horse-battery', fakeAuth(200, { paired: true }, seen))

    expect(state).toEqual({ paired: true })
    expect(seen).toEqual([
      { method: 'POST', body: '{"accessCode":"correct-horse-battery"}', contentType: 'application/json' },
    ])
  })

  test('a wrong code surfaces as an ApiError carrying the server code', async () => {
    const call = pairDevice('nope', fakeAuth(401, { code: 'WRONG_ACCESS_CODE', message: "That code didn't work" }))
    await expect(call).rejects.toMatchObject({ status: 401, code: 'WRONG_ACCESS_CODE' })
    await expect(call).rejects.toBeInstanceOf(ApiError)
  })
})

type Call = { url: string; method: string }

/** A fake `fetch` for one endpoint that records every request it receives. */
function fakeEndpoint(path: string, status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.endsWith(path)) throw new Error(`unexpected request to ${url}`)
    calls.push({ url, method: init?.method ?? 'GET' })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}

describe('runBootstrap', () => {
  test('posts to the bootstrap function and returns its report', async () => {
    const calls: Call[] = []
    const report = {
      receiptsFolder: { id: 'f1', created: true },
      ledger: { id: 's1', url: 'https://docs.google.com/spreadsheets/d/s1', created: true },
      tabs: { Expenses: { created: true }, Members: { created: true }, Categories: { created: true }, Recurring_Rules: { created: true } },
      seeded: { Expenses: 0, Members: 1, Categories: 7, Recurring_Rules: 0 },
    }

    const result = await runBootstrap(fakeEndpoint('/api/bootstrap', 200, report, calls))

    expect(result).toEqual(report)
    expect(calls).toEqual([{ url: '/api/bootstrap', method: 'POST' }])
  })

  test('a misconfigured server surfaces as an ApiError with its code', async () => {
    const call = runBootstrap(
      fakeEndpoint('/api/bootstrap', 500, { code: 'SERVER_MISCONFIGURED', message: 'missing GOOGLE_REFRESH_TOKEN' }),
    )
    await expect(call).rejects.toMatchObject({ status: 500, code: 'SERVER_MISCONFIGURED', message: 'missing GOOGLE_REFRESH_TOKEN' })
  })
})

describe('getReadModel', () => {
  const model = {
    expenses: [],
    members: [
      { memberId: 'admin', name: 'Admin', role: 'admin', defaultPaymentMethod: 'UPI', pinHash: 'f8e6', avatarColor: '#6E7250' },
      { memberId: 'kid1', name: 'Kiddo', role: 'kid', defaultPaymentMethod: 'Cash', pinHash: null, avatarColor: '#A9603F' },
    ],
    categories: [{ name: 'Other', emoji: '📦', colorHex: '#6E7250', monthlyBudgetLimit: 0, visibleToRoles: ['all'] }],
    recurringRules: [{ ruleId: 'rent', title: 'Rent', amount: 25000, category: 'Household & Help', dueDayOfMonth: 1 }],
    ledgerUrl: 'https://docs.google.com/spreadsheets/d/s1',
    serverTime: '2026-10-31T12:00:00+05:30',
  }

  test('GETs the expenses function and keeps a null pinHash null', async () => {
    const calls: Call[] = []

    const result = await getReadModel(fakeEndpoint('/api/expenses', 200, model, calls))

    expect(result).toEqual(model)
    expect(result.members[1]?.pinHash).toBeNull()
    expect(calls).toEqual([{ url: '/api/expenses', method: 'GET' }])
  })

  test('a missing Ledger surfaces as LEDGER_NOT_FOUND so the app can re-run Bootstrap', async () => {
    const call = getReadModel(fakeEndpoint('/api/expenses', 404, { code: 'LEDGER_NOT_FOUND', message: 'run Bootstrap' }))
    await expect(call).rejects.toMatchObject({ status: 404, code: 'LEDGER_NOT_FOUND' })
  })
})

describe('getReadModel window', () => {
  test('asks for a from/to window when one is given', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input))
      return Response.json({ expenses: [], members: [], categories: [], recurringRules: [], ledgerUrl: '', serverTime: '' })
    }

    await getReadModel(fetchImpl, { from: '2026-01-01', to: '2026-01-31' })
    await getReadModel(fetchImpl, { from: '2026-01-01' })

    expect(urls).toEqual(['/api/expenses?from=2026-01-01&to=2026-01-31', '/api/expenses?from=2026-01-01'])
  })
})

describe('createExpense', () => {
  const input: CreateExpenseInput = {
    id: '6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10',
    expenseDate: '2026-10-30',
    loggedBy: 'ramesh',
    paidBy: 'ramesh',
    amount: 450,
    category: 'Medical & Pharmacy',
    merchantNote: 'medicines for Papa',
    paymentMethod: 'Cash',
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

  function fakeCreate(status: number, body: unknown, seen: { method: string; body: unknown }[]): typeof fetch {
    return async (input, init) => {
      if (String(input) !== '/api/expenses') throw new Error(`unexpected request to ${String(input)}`)
      seen.push({ method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) })
      return Response.json(body, { status })
    }
  }

  test('POSTs the Expense as JSON and returns what the server stored', async () => {
    const seen: { method: string; body: unknown }[] = []

    const result = await createExpense(input, fakeCreate(201, stored, seen))

    expect(result).toEqual({ expense: stored, replayed: false })
    expect(seen).toEqual([{ method: 'POST', body: input }])
  })

  test('a 200 is an idempotent replay of an Expense already in the Ledger', async () => {
    const result = await createExpense(input, fakeCreate(200, { ...stored, merchantNote: 'first try' }, []))

    expect(result).toEqual({ expense: { ...stored, merchantNote: 'first try' }, replayed: true })
  })

  test('a rejected Expense surfaces the server code', async () => {
    const call = createExpense(input, fakeCreate(422, { code: 'UNKNOWN_CATEGORY', message: 'not a Category' }, []))
    await expect(call).rejects.toMatchObject({ status: 422, code: 'UNKNOWN_CATEGORY' })
    await expect(call).rejects.toBeInstanceOf(ApiError)
  })
})
