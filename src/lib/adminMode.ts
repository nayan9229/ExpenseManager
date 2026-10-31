/**
 * Admin Mode's numbers, computed on the device from the Expenses of the
 * selected month (spec: "Burn Rate and totals are computed client-side").
 * Pure functions, so the dashboard only lays them out.
 */
import { isActive, type BootstrapReport, type Category, type Expense, type Member, type RecurringRule } from './api'
import { daysIn, monthOf, type Month } from './month'
import type { ExpenseDraft } from './quickExpense'

/** One bar: spend against a Budget. No Budget (0) means no bar: `fraction` is null. */
export type Bar = {
  spent: number
  budget: number
  /** spent / budget, uncapped (1.2 is 20% over); null when there is no Budget. */
  fraction: number | null
  /** Spend above the Budget: drawn in terracotta. */
  over: boolean
}

export type CategoryBurn = Bar & {
  name: string
  emoji: string
  /** How many Expenses make up `spent`. */
  count: number
}

export type BurnRates = {
  /** Every rupee spent in the month against the sum of the Category Budgets. */
  household: Bar
  /** Ledger order, then any Category an Expense names that the Ledger no longer has. */
  categories: CategoryBurn[]
}

/** Category names compare without case or surrounding spaces, like the server does. */
export const categoryKey = (name: string) => name.trim().toLowerCase()

/** Sums rupee amounts without floating-point dust (0.1 + 0.2 is 0.3). */
function addRupees(a: number, b: number): number {
  return Math.round((a + b) * 100) / 100
}

function bar(spent: number, budget: number): Bar {
  return budget > 0 ? { spent, budget, fraction: spent / budget, over: spent > budget } : { spent, budget: 0, fraction: null, over: false }
}

/** The Burn Rate (GLOSSARY) of each Category and of the Household for these Expenses. */
export function burnRates(categories: Category[], expenses: Expense[]): BurnRates {
  const totals = new Map<string, { name: string; spent: number; count: number }>()
  for (const c of categories) {
    if (!totals.has(categoryKey(c.name))) totals.set(categoryKey(c.name), { name: c.name, spent: 0, count: 0 })
  }
  let householdSpent = 0
  for (const e of expenses) {
    if (!isActive(e)) continue
    const key = categoryKey(e.category)
    const total = totals.get(key) ?? { name: e.category.trim(), spent: 0, count: 0 }
    total.spent = addRupees(total.spent, e.amount)
    total.count += 1
    totals.set(key, total)
    householdSpent = addRupees(householdSpent, e.amount)
  }
  const known = new Map(categories.map((c) => [categoryKey(c.name), c]))
  const rows = [...totals.entries()].map(([key, t]) => {
    const c = known.get(key)
    return { ...bar(t.spent, c?.monthlyBudgetLimit ?? 0), name: t.name, emoji: c?.emoji ?? '📦', count: t.count }
  })
  const householdBudget = categories.reduce((sum, c) => addRupees(sum, c.monthlyBudgetLimit > 0 ? c.monthlyBudgetLimit : 0), 0)
  return { household: bar(householdSpent, householdBudget), categories: rows }
}

/**
 * The Member filter: the Expenses `memberId` paid for (GLOSSARY: Paid By,
 * whose money it was), whoever logged them. Null is the whole Household.
 */
export function paidByMember(expenses: Expense[], memberId: string | null): Expense[] {
  return memberId === null ? expenses : expenses.filter((e) => e.paidBy === memberId)
}

export type BreakdownRow = CategoryBurn & {
  /** Fraction of the month's total spend. */
  share: number
}

/** The Category breakdown: Categories with spend, largest first, with their share of the total. */
export function breakdown(burn: BurnRates): BreakdownRow[] {
  const total = burn.household.spent
  return burn.categories
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, share: total > 0 ? c.spent / total : 0 }))
    .sort((a, b) => b.spent - a.spent)
}

/** One Member's share of the Reimbursable Queue. */
export type ReimbursementGroup = {
  /** The Paid By Member ID. */
  memberId: string
  /** Their name, or "Unknown" for a Member no longer in the Ledger. */
  name: string
  /** What the Household owes them. */
  total: number
  /** Oldest first: the longest-owed is settled first. */
  expenses: Expense[]
}

/**
 * The Reimbursable Queue (GLOSSARY): active Expenses whose Reimbursement is
 * `pending`, grouped by the Member who paid, in Ledger order (unknown
 * payers last).
 */
export function reimbursableQueue(expenses: Expense[], members: Member[]): ReimbursementGroup[] {
  const groups = new Map<string, ReimbursementGroup>()
  for (const e of expenses) {
    if (!isActive(e) || e.reimbursementStatus !== 'pending') continue
    const group = groups.get(e.paidBy) ?? {
      memberId: e.paidBy,
      name: members.find((m) => m.memberId === e.paidBy)?.name ?? 'Unknown',
      total: 0,
      expenses: [],
    }
    group.total = addRupees(group.total, e.amount)
    group.expenses.push(e)
    groups.set(e.paidBy, group)
  }
  const order = (id: string) => {
    const i = members.findIndex((m) => m.memberId === id)
    return i < 0 ? members.length : i
  }
  for (const g of groups.values()) g.expenses.sort((a, b) => (a.expenseDate === b.expenseDate ? a.createdAt.localeCompare(b.createdAt) : a.expenseDate < b.expenseDate ? -1 : 1))
  return [...groups.values()].sort((a, b) => order(a.memberId) - order(b.memberId))
}

/**
 * Several fetched windows as one list: one copy per ID, the most recently
 * updated copy winning (the month view and the default window overlap).
 */
export function mergeExpenses(...lists: Expense[][]): Expense[] {
  const byId = new Map<string, Expense>()
  for (const e of lists.flat()) {
    const seen = byId.get(e.id)
    if (!seen || e.updatedAt > seen.updatedAt) byId.set(e.id, e)
  }
  return [...byId.values()]
}

/** A Recurring Rule not yet logged in the month, and the day it falls due. */
export type DueRule = {
  rule: RecurringRule
  /** `YYYY-MM-DD`; a due day past the month's end falls on its last day. */
  dueDate: string
}

/**
 * The "Due this month, not logged" card: Recurring Rules with no active
 * Expense in the same Category dated in `month`, soonest due first.
 */
export function dueNotLogged(rules: RecurringRule[], expenses: Expense[], month: Month): DueRule[] {
  const logged = new Set(
    expenses.filter((e) => isActive(e) && monthOf(e.expenseDate) === month).map((e) => categoryKey(e.category)),
  )
  const lastDay = daysIn(month)
  return rules
    .filter((r) => !logged.has(categoryKey(r.category)))
    .map((rule) => ({ rule, dueDate: `${month}-${String(Math.min(rule.dueDayOfMonth, lastDay)).padStart(2, '0')}` }))
    .sort((a, b) => (a.dueDate === b.dueDate ? 0 : a.dueDate < b.dueDate ? -1 : 1))
}

/**
 * The Quick Expense prefill for one tap on a due Rule: its amount, its
 * Category in the Ledger's spelling (null if the Ledger no longer has it),
 * its title as the note, dated the due day or today if that is still ahead.
 */
export function prefillFromRule(rule: RecurringRule, dueDate: string, categories: Category[], today: string): Partial<ExpenseDraft> {
  return {
    amount: rule.amount,
    category: categories.find((c) => categoryKey(c.name) === categoryKey(rule.category))?.name ?? null,
    note: rule.title,
    expenseDate: dueDate > today ? today : dueDate,
  }
}

const TAB_ORDER = ['Expenses', 'Members', 'Categories', 'Recurring_Rules']
const ROW_NAMES: Record<string, [string, string]> = {
  Expenses: ['Expense', 'Expenses'],
  Members: ['Member', 'Members'],
  Categories: ['Category', 'Categories'],
  Recurring_Rules: ['Recurring Rule', 'Recurring Rules'],
}
const tabName = (tab: string) => tab.replace(/_/g, ' ')

/** What Repair (Bootstrap again) found missing and put back, one sentence per thing. */
export function repairSummary(report: BootstrapReport): string[] {
  const lines: string[] = []
  if (report.receiptsFolder.created) lines.push('Recreated the Receipts folder in Drive.')
  const tabs = Object.keys(report.tabs).sort((a, b) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b))
  if (report.ledger.created) {
    lines.push('Created a new Ledger with its four tabs.')
  } else {
    for (const tab of tabs) if (report.tabs[tab]?.created) lines.push(`Recreated the ${tabName(tab)} tab.`)
  }
  const seeded = Object.keys(report.seeded).sort((a, b) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b))
  for (const tab of seeded) {
    const n = report.seeded[tab] ?? 0
    if (n <= 0) continue
    const [one, many] = ROW_NAMES[tab] ?? [`${tabName(tab)} row`, `${tabName(tab)} rows`]
    lines.push(`Added ${n} starter ${n === 1 ? one : many}.`)
  }
  const headed = [...(report.headersWritten ?? [])].sort((a, b) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b))
  for (const tab of headed) lines.push(`Wrote the headers in row 1 of the ${tabName(tab)} tab.`)
  return lines.length > 0 ? lines : ['Nothing was missing. The Receipts folder, the Ledger and its four tabs are all there.']
}

/** What Repair found wrong but would not overwrite: the server's sentence for each tab. */
export function repairWarnings(report: BootstrapReport): string[] {
  return (report.headerMismatches ?? []).map((m) => m.message)
}
