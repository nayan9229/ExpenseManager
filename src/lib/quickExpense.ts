/**
 * Quick Expense rules that do not need a screen: which Categories a Role
 * sees, the soft duplicate check, a Member's last five, and the form draft
 * that the Quick Expense form edits and turns into a create.
 *
 * The draft is shared with ticket 05 (edit), 06 (Receipt prefill) and 10
 * (voice prefill): they start from `newDraft` or their own partial draft.
 */
import type { Category, CreateExpenseInput, Expense, Member, PaymentMethod, ReimbursementStatus, Role } from './api'
import { addDays } from './istDate'

/** Everything the Quick Expense form edits. */
export type ExpenseDraft = {
  /** Rupees; 0 means nothing typed yet. The keypad keeps it whole. */
  amount: number
  category: string | null
  paymentMethod: PaymentMethod
  /** `YYYY-MM-DD`, IST. */
  expenseDate: string
  note: string
  /** "I paid from my own pocket" on means `pending`. */
  reimbursementStatus: ReimbursementStatus
  /** Member ID; defaults to the Member logging it. */
  paidBy: string
}

/**
 * The Categories a Role sees on the grid, in Ledger order (user story 23).
 * `keep` names a Category to show regardless, so editing an Expense whose
 * Category the Role cannot see does not silently drop it.
 */
export function visibleCategories(categories: Category[], role: Role, keep?: string | null): Category[] {
  return categories.filter(
    (c) => c.visibleToRoles.includes('all') || c.visibleToRoles.includes(role) || (keep != null && c.name === keep),
  )
}

/**
 * An active Expense in the loaded window with the same amount, Category and
 * date, if any (user story 21). The Household is checked, not only the
 * Member: two parents logging the same groceries is the double-log to catch.
 * `excludeId` is the Expense being edited.
 */
export function findDuplicate(
  expenses: Expense[],
  candidate: { amount: number; category: string; expenseDate: string },
  excludeId?: string,
): Expense | null {
  return (
    expenses.find(
      (e) =>
        e.status === 'active' &&
        e.id !== excludeId &&
        e.amount === candidate.amount &&
        e.category === candidate.category &&
        e.expenseDate === candidate.expenseDate,
    ) ?? null
  )
}

/** Newest first: Expense date, then when it was logged. */
export function byNewest(a: Expense, b: Expense): number {
  if (a.expenseDate !== b.expenseDate) return a.expenseDate < b.expenseDate ? 1 : -1
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
  return 0
}

/** The Member's own last five active Expenses for Simple Mode. */
export function lastFive(expenses: Expense[], memberId: string): Expense[] {
  return expenses
    .filter((e) => e.status === 'active' && e.loggedBy === memberId)
    .sort(byNewest)
    .slice(0, 5)
}

/** A blank Quick Expense for `member`, dated `today`. */
export function newDraft(member: Member, today: string): ExpenseDraft {
  return {
    amount: 0,
    category: null,
    paymentMethod: member.defaultPaymentMethod,
    expenseDate: today,
    note: '',
    reimbursementStatus: 'none',
    paidBy: member.memberId,
  }
}

/** Why the draft cannot be saved yet, in words for the Save area; null when it can. */
export function draftProblem(draft: ExpenseDraft, today: string): string | null {
  if (!(draft.amount > 0)) return 'Enter the amount'
  if (!draft.category) return 'Pick a Category'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expenseDate)) return 'Pick a date'
  if (draft.expenseDate > addDays(today, 1)) return 'The date cannot be after tomorrow'
  return null
}

/** The create request for a saveable draft. */
export function toCreateInput(draft: ExpenseDraft, loggedBy: string, id: string): CreateExpenseInput {
  return {
    id,
    expenseDate: draft.expenseDate,
    loggedBy,
    paidBy: draft.paidBy || loggedBy,
    amount: draft.amount,
    category: draft.category ?? '',
    merchantNote: draft.note.trim(),
    paymentMethod: draft.paymentMethod,
    reimbursementStatus: draft.reimbursementStatus,
  }
}

/**
 * A new Expense ID. `crypto.randomUUID` needs a secure context (HTTPS or
 * localhost), which the app always has; the fallback covers older Safari.
 */
export function newExpenseId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
