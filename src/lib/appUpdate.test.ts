import { describe, expect, test } from 'vitest'
import { reloadsForUpdate } from './appUpdate'

describe('reloadsForUpdate', () => {
  test('a new version reloads the app once it is in the background with nothing half done', () => {
    expect(reloadsForUpdate({ updateReady: true, hidden: true, busy: false })).toBe(true)
  })

  test('never while the Member is looking at it, never over a half-filled form, and not without a new version', () => {
    expect(reloadsForUpdate({ updateReady: true, hidden: false, busy: false })).toBe(false)
    expect(reloadsForUpdate({ updateReady: true, hidden: true, busy: true })).toBe(false)
    expect(reloadsForUpdate({ updateReady: false, hidden: true, busy: false })).toBe(false)
  })
})
