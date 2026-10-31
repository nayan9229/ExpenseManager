/**
 * The Quick Expense amount keypad as a reducer (user stories 15 and 22):
 * digits, backspace, +50 / +100 / +500, whole rupees only. The amount is a
 * number of rupees; 0 means nothing typed yet.
 */

/** One crore, the largest Expense the server accepts. */
export const MAX_AMOUNT = 10_000_000

export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type KeypadKey = Digit | 'backspace' | 'clear' | { add: 50 | 100 | 500 }

/** The amount after one key press. A key that would pass one crore does nothing. */
export function pressKey(amount: number, key: KeypadKey): number {
  if (key === 'clear') return 0
  if (typeof key === 'object') {
    const next = amount + key.add
    return next > MAX_AMOUNT ? amount : next
  }
  // Typing over a prefilled amount (OCR, voice) works on whole rupees.
  const rupees = Math.trunc(amount)
  if (key === 'backspace') return Math.trunc(rupees / 10)
  const next = rupees * 10 + key
  return next > MAX_AMOUNT ? rupees : next
}
