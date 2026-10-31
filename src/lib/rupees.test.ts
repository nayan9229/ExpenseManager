import { describe, expect, test } from 'vitest'
import { formatRupees } from './rupees'

describe('formatRupees', () => {
  test('groups lakhs and crores the Indian way', () => {
    expect(formatRupees(1234567.5)).toBe('₹12,34,567.50')
  })

  test('shows whole rupees without paise', () => {
    expect(formatRupees(250)).toBe('₹250')
  })

  test('keeps paise when present', () => {
    expect(formatRupees(99.9)).toBe('₹99.90')
  })

  test('renders zero as zero rupees', () => {
    expect(formatRupees(0)).toBe('₹0')
  })
})
