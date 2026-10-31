import { describe, expect, test } from 'vitest'
import type { Member } from './api'
import { ADMIN_BACKGROUND_LIMIT_MS, backgroundTimer, memberAfterAdmin, startingMember } from './adminLock'

const MIN = 60_000

describe('backgroundTimer', () => {
  test('the limit is five minutes', () => {
    expect(ADMIN_BACKGROUND_LIMIT_MS).toBe(5 * MIN)
  })

  test('coming back after less than five minutes keeps Admin Mode open', () => {
    const timer = backgroundTimer()
    timer.hidden(1_000_000)
    expect(timer.visible(1_000_000 + 5 * MIN - 1)).toBe(false)
  })

  test('coming back after five minutes or more locks it', () => {
    const timer = backgroundTimer()
    timer.hidden(1_000_000)
    expect(timer.visible(1_000_000 + 5 * MIN)).toBe(true)
  })

  test('each trip to the background is timed on its own', () => {
    const timer = backgroundTimer()
    timer.hidden(0)
    expect(timer.visible(4 * MIN)).toBe(false)
    timer.hidden(10 * MIN)
    expect(timer.visible(14 * MIN)).toBe(false)
  })

  test('a repeated hidden event keeps the time it first went away', () => {
    const timer = backgroundTimer()
    timer.hidden(0)
    timer.hidden(4 * MIN)
    expect(timer.visible(6 * MIN)).toBe(true)
  })

  test('visible without having been hidden never locks', () => {
    expect(backgroundTimer().visible(99 * MIN)).toBe(false)
  })

  test('takes a different limit', () => {
    const timer = backgroundTimer(1000)
    timer.hidden(0)
    expect(timer.visible(1000)).toBe(true)
  })
})

const member = (memberId: string, role: Member['role']): Member => ({
  memberId,
  name: memberId,
  role,
  defaultPaymentMethod: 'UPI',
  pinHash: role === 'admin' ? 'hash' : null,
  avatarColor: '#6E7250',
})
const members = [member('admin', 'admin'), member('mom', 'parent'), member('kid1', 'kid')]

describe('memberAfterAdmin', () => {
  test('is the last non-Admin Member this device used', () => {
    expect(memberAfterAdmin(members, 'kid1')?.memberId).toBe('kid1')
  })

  test('is nobody (the switcher) when there was none, or they left the Ledger', () => {
    expect(memberAfterAdmin(members, null)).toBeNull()
    expect(memberAfterAdmin(members, 'uncle')).toBeNull()
  })

  test('is never an Admin', () => {
    expect(memberAfterAdmin(members, 'admin')).toBeNull()
    expect(memberAfterAdmin([member('mom', 'admin')], 'mom')).toBeNull()
  })
})

describe('startingMember', () => {
  test('a remembered parent or kid opens straight into Simple Mode', () => {
    expect(startingMember(members, 'mom')?.memberId).toBe('mom')
  })

  test('a remembered Admin goes to the switcher, so the PIN is asked again', () => {
    expect(startingMember(members, 'admin')).toBeNull()
  })

  test('an unknown or missing Member goes to the switcher', () => {
    expect(startingMember(members, 'uncle')).toBeNull()
    expect(startingMember(members, null)).toBeNull()
  })
})
