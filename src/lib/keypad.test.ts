import { describe, expect, test } from 'vitest'
import { MAX_AMOUNT, pressKey, type KeypadKey } from './keypad'

function type(keys: KeypadKey[], start = 0): number {
  return keys.reduce(pressKey, start)
}

describe('pressKey', () => {
  test('digits build a whole-rupee amount', () => {
    expect(type([4, 5, 0])).toBe(450)
  })

  test('a leading zero is ignored', () => {
    expect(type([0, 0, 7])).toBe(7)
  })

  test('backspace drops the last digit, down to nothing', () => {
    expect(type([4, 5, 0, 'backspace'])).toBe(45)
    expect(type([4, 'backspace', 'backspace'])).toBe(0)
  })

  test('+50, +100 and +500 add to what is there', () => {
    expect(type([{ add: 500 }, { add: 100 }, { add: 50 }])).toBe(650)
    expect(type([4, 0, 0, { add: 50 }])).toBe(450)
  })

  test('clear empties the amount', () => {
    expect(type([9, 9, 'clear'])).toBe(0)
  })

  test('nothing goes past one crore', () => {
    expect(type([1, 0, 0, 0, 0, 0, 0, 0])).toBe(10_000_000)
    expect(type([1, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(10_000_000)
    expect(type([{ add: 500 }], MAX_AMOUNT - 100)).toBe(MAX_AMOUNT - 100)
  })

  test('typing over a prefilled amount with paise drops the paise', () => {
    expect(pressKey(1234.5, 'backspace')).toBe(123)
    expect(pressKey(12.5, 3)).toBe(123)
    expect(pressKey(1234.5, { add: 50 })).toBe(1284.5)
  })
})
