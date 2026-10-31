import { describe, expect, test } from 'vitest'
import { ApiError, getSessionState, pairDevice } from './api'

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
