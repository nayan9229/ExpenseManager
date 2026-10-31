import { describe, expect, test } from 'vitest'
import { ApiError, getSessionState } from './api'

function fakeFetch(status: number, body: unknown): typeof fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.endsWith('/api/auth')) throw new Error(`unexpected request to ${url}`)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}

describe('getSessionState', () => {
  test('reports an unpaired device from the auth GET', async () => {
    const state = await getSessionState(fakeFetch(200, { paired: false }))
    expect(state).toEqual({ paired: false })
  })

  test('surfaces the server error envelope as an ApiError', async () => {
    const call = getSessionState(fakeFetch(500, { code: 'BOOM', message: 'it broke' }))
    await expect(call).rejects.toMatchObject({ code: 'BOOM', message: 'it broke', status: 500 })
    await expect(call).rejects.toBeInstanceOf(ApiError)
  })
})
