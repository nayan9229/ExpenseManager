/**
 * Editing and deleting an Expense (user stories 53 to 56): who may, and
 * the bridge between a stored Expense and the Quick Expense form's draft.
 */
import { isActive, normaliseReceiptNumber, type Expense, type Member, type UpdateExpenseInput } from './api'
import type { ExpenseDraft } from './quickExpense'

/**
 * Whether `member` may edit or delete `expense`: an Admin any active
 * Expense, everyone else only the ones they logged. Enforced on the device
 * only (ADR-0002); the server trusts every paired device.
 */
export function canEdit(member: Member, expense: Expense): boolean {
  if (!isActive(expense)) return false
  return member.role === 'admin' || expense.loggedBy === member.memberId
}

/** The form's starting values for an existing Expense. */
export function draftFromExpense(expense: Expense): ExpenseDraft {
  return {
    amount: expense.amount,
    category: expense.category,
    paymentMethod: expense.paymentMethod,
    expenseDate: expense.expenseDate,
    note: expense.merchantNote,
    reimbursementStatus: expense.reimbursementStatus,
    paidBy: expense.paidBy,
    // Absent on a copy from an older server: left out, so Save cannot wipe a Receipt No. it never saw.
    ...(expense.receiptNumber === undefined ? {} : { receiptNumber: expense.receiptNumber }),
  }
}

/** The edit request for a saveable draft: every editable field, nothing else. */
export function toUpdateInput(draft: ExpenseDraft, id: string): UpdateExpenseInput {
  return {
    id,
    expenseDate: draft.expenseDate,
    paidBy: draft.paidBy,
    amount: draft.amount,
    category: draft.category ?? '',
    merchantNote: draft.note.trim(),
    paymentMethod: draft.paymentMethod,
    reimbursementStatus: draft.reimbursementStatus,
    // Blank is sent as '' so Save clears a Receipt No. the Member deleted.
    ...(draft.receiptNumber === undefined ? {} : { receiptNumber: normaliseReceiptNumber(draft.receiptNumber) ?? '' }),
  }
}
