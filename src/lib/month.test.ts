import { describe, expect, test } from 'vitest'
import { monthLabel, monthOf, monthWindow, shiftMonth } from './month'

describe('monthWindow', () => {
  test('covers the whole calendar month, first to last day', () => {
    expect(monthWindow('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthWindow('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })

  test('knows February in leap and common years', () => {
    expect(monthWindow('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthWindow('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
})

describe('monthOf', () => {
  test('is the IST calendar month of a date', () => {
    expect(monthOf('2026-10-31')).toBe('2026-10')
  })

  test('uses the IST clock: 20:00 UTC on 31 Oct is already November in India', () => {
    expect(monthOf(new Date('2026-10-31T20:00:00Z'))).toBe('2026-11')
    expect(monthOf(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10')
  })
})

describe('shiftMonth', () => {
  test('steps back and forward across year ends', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-10', -13)).toBe('2025-09')
  })
})

describe('monthLabel', () => {
  test('reads as the month name and year', () => {
    expect(monthLabel('2026-10')).toBe('October 2026')
    expect(monthLabel('2027-01')).toBe('January 2027')
  })
})
