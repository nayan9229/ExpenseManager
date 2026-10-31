import { describe, expect, test } from 'vitest'
import { ApiError, getReadModel, getSessionState, pairDevice, runBootstrap } from './api'

type Seen = { method: string; body: string | null; contentType: string | null }

/** A fake `fetch` for /api/auth that records the one request it receives. */
function fakeAuth(status: number, body: unknown, seen: Seen[] = []): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.endsWith('/api/auth')) throw new Error(`unexpected request to ${url}`)
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
  test('reports an unpaired device from the auth GET', async () => {
    const state = await getSessionState(fakeAuth(200, { paired: false }))
    expect(state).toEqual({ paired: false })
  })

  test('reports a paired device from the auth GET', async () => {
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
