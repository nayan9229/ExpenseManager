/**
 * Calendar months in the Household's clock (IST), as `YYYY-MM` strings.
 * Admin Mode shows one month at a time and fetches exactly its days.
 */
import type { ExpenseWindow } from './api'
import { istToday } from './istDate'

/** `YYYY-MM`. */
export type Month = string

const NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function parts(month: Month): [number, number] {
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
}

function format(year: number, monthNumber: number): Month {
  return `${String(year).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}`
}

/** The month a `YYYY-MM-DD` date falls in, or the IST month of an instant. */
export function monthOf(date: string | Date): Month {
  return (typeof date === 'string' ? date : istToday(date)).slice(0, 7)
}

/** How many days `month` has. */
export function daysIn(month: Month): number {
  const [year, m] = parts(month)
  return new Date(Date.UTC(year, m, 0)).getUTCDate()
}

/** The inclusive `from` / `to` the `expenses` GET takes for `month`. */
export function monthWindow(month: Month): Required<ExpenseWindow> {
  return { from: `${month}-01`, to: `${month}-${String(daysIn(month)).padStart(2, '0')}` }
}

/** The month `n` months after (or before, when negative) `month`. */
export function shiftMonth(month: Month, n: number): Month {
  const [year, m] = parts(month)
  const index = year * 12 + (m - 1) + n
  return format(Math.floor(index / 12), (index % 12) + 1)
}

/** `October 2026`. */
export function monthLabel(month: Month): string {
  const [year, m] = parts(month)
  return `${NAMES[m - 1] ?? month} ${year}`
}
