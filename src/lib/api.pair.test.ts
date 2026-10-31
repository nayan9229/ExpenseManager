import { describe, expect, test } from 'vitest'
import { ApiError, getPairToken, pairWithCode } from './api'

type Seen = { method: string; url: string; body: string | null }

function fake(status: number, body: unknown, seen: Seen[]): typeof fetch {
  return async (input, init) => {
    seen.push({ method: init?.method ?? 'GET', url: String(input), body: typeof init?.body === 'string' ? init.body : null })
    return Response.json(body, { status })
  }
}

describe('pairWithCode', () => {
  test('posts the Pair Code to pair and reports the device paired', async () => {
    const seen: Seen[] = []

    const state = await pairWithCode('ABCD2345', fake(200, { paired: true }, seen))

    expect(state).toEqual({ paired: true })
    expect(seen).toEqual([{ method: 'POST', url: '/api/pair', body: '{"pairCode":"ABCD2345"}' }])
  })

  test('a stale or wrong code surfaces as WRONG_PAIR_CODE', async () => {
    const call = pairWithCode('ABCD2345', fake(401, { code: 'WRONG_PAIR_CODE', message: "That code didn't work" }, []))
    await expect(call).rejects.toMatchObject({ status: 401, code: 'WRONG_PAIR_CODE' })
    await expect(call).rejects.toBeInstanceOf(ApiError)
  })
})

describe('getPairToken', () => {
  test('returns the code, the QR link and the expiry', async () => {
    const seen: Seen[] = []
    const token = { pairCode: 'ABCD2345', url: 'https://family.example/?pairToken=ABCD2345', expiresAt: '2026-10-31T12:20:00Z' }

    expect(await getPairToken(fake(200, token, seen))).toEqual(token)
    expect(seen).toEqual([{ method: 'GET', url: '/api/pair-token', body: null }])
  })

  test('an unpaired device gets NOT_PAIRED', async () => {
    const call = getPairToken(fake(401, { code: 'NOT_PAIRED', message: 'This device is not paired' }, []))
    await expect(call).rejects.toMatchObject({ status: 401, code: 'NOT_PAIRED' })
  })

  test('a response without a code is an error, not an empty QR', async () => {
    await expect(getPairToken(fake(200, { url: 'x' }, []))).rejects.toBeInstanceOf(ApiError)
  })
})
