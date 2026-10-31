import { describe, expect, test } from 'vitest'
import { hashPin, verifyPin } from './pin'

// Known-good hashes, computed outside this code base and shared with the Go
// tests so both sides agree on SHA-256("<memberId>:<pin>"):
//   printf 'admin:1234'  | shasum -a 256
//   printf 'ramesh:0123' | shasum -a 256
const adminPinHash = 'f8e68e8d44bfb5314974a97f787d017ff6ac9d0046083f28665fcf96f0cef80c'
const rameshPinHash = 'bb9df8aff41c19732740d6e1d7203895194632fbf5c1feb4a21b2c8def202234'

describe('hashPin', () => {
  test('matches the server: hex SHA-256 of memberId:pin', async () => {
    expect(await hashPin('admin', '1234')).toBe(adminPinHash)
  })

  test('keeps a leading zero', async () => {
    expect(await hashPin('ramesh', '0123')).toBe(rameshPinHash)
  })
})

describe('verifyPin', () => {
  const admin = { memberId: 'admin', pinHash: adminPinHash }

  test('accepts the right PIN', async () => {
    expect(await verifyPin(admin, '1234')).toBe(true)
  })

  test('rejects a wrong PIN', async () => {
    expect(await verifyPin(admin, '1235')).toBe(false)
  })

  test('rejects the same PIN for another Member', async () => {
    expect(await verifyPin({ memberId: 'ramesh', pinHash: adminPinHash }, '1234')).toBe(false)
  })

  test('never accepts anything when no PIN is set', async () => {
    expect(await verifyPin({ memberId: 'admin', pinHash: null }, '')).toBe(false)
    expect(await verifyPin({ memberId: 'admin', pinHash: null }, '1234')).toBe(false)
  })
})
