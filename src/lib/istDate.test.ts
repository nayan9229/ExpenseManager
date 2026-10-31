import { describe, expect, test } from 'vitest'
import { addDays, dayLabel, istToday } from './istDate'

describe('istToday', () => {
  test('is the calendar date in India, not on the device clock', () => {
    // 18:29 UTC on 30 Oct is 23:59 IST; 18:30 UTC is already 31 Oct in India.
    expect(istToday(new Date('2026-10-30T18:29:59Z'))).toBe('2026-10-30')
    expect(istToday(new Date('2026-10-30T18:30:00Z'))).toBe('2026-10-31')
  })
})

describe('addDays', () => {
  test('crosses months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('dayLabel', () => {
  test('says Today and Yesterday, otherwise weekday, day and month', () => {
    expect(dayLabel('2026-10-31', '2026-10-31')).toBe('Today')
    expect(dayLabel('2026-10-30', '2026-10-31')).toBe('Yesterday')
    expect(dayLabel('2026-11-01', '2026-10-31')).toBe('Tomorrow')
    expect(dayLabel('2026-10-29', '2026-10-31')).toBe('Thu 29 Oct')
    expect(dayLabel('2025-12-25', '2026-10-31')).toBe('Thu 25 Dec 2025')
  })
})
