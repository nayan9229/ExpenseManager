import { describe, expect, test } from 'vitest'
import type { Expense, Member } from './api'
import { canEdit, draftFromExpense, toUpdateInput } from './editExpense'

const member = (memberId: string, role: Member['role']): Member => ({
  memberId,
  name: memberId,
  role,
  defaultPaymentMethod: 'UPI',
  pinHash: null,
  avatarColor: '#6E7250',
})

const admin = member('admin', 'admin')
const ramesh = member('ramesh', 'parent')
const kid = member('kid1', 'kid')

const expense: Expense = {
  id: '0b8a3c2e-5f4d-4e61-8a9b-7c6d5e4f3a21',
  createdAt: '2026-10-30T20:00:00+05:30',
  updatedAt: '2026-10-30T20:00:00+05:30',
  expenseDate: '2026-10-30',
  loggedBy: 'ramesh',
  paidBy: 'kid1',
  amount: 450.5,
  currency: 'INR',
  category: 'Medical & Pharmacy',
  merchantNote: 'medicines for Papa',
  paymentMethod: 'Cash',
  driveFileId: 'drive-1',
  driveViewUrl: 'https://drive.example/1',
  fileHash: 'hash-1',
  reimbursementStatus: 'done',
  status: 'active',
  receiptNumber: '004521',
}

describe('canEdit (ADR-0002: enforced on the device only)', () => {
  test('the Member who logged it may edit or delete it', () => {
    expect(canEdit(ramesh, expense)).toBe(true)
  })

  test('an Admin may edit or delete any Expense', () => {
    expect(canEdit(admin, expense)).toBe(true)
  })

  test('another Member may not, even the one who paid for it', () => {
    expect(canEdit(kid, expense)).toBe(false)
    expect(canEdit(member('dadi', 'parent'), expense)).toBe(false)
  })

  test('a deleted Expense cannot be edited by anyone', () => {
    expect(canEdit(admin, { ...expense, status: 'deleted' })).toBe(false)
  })
})

describe('draftFromExpense', () => {
  test('prefills every editable field, paise and Reimbursement included', () => {
    expect(draftFromExpense(expense)).toEqual({
      amount: 450.5,
      category: 'Medical & Pharmacy',
      paymentMethod: 'Cash',
      expenseDate: '2026-10-30',
      note: 'medicines for Papa',
      reimbursementStatus: 'done',
      paidBy: 'kid1',
      receiptNumber: '004521',
    })
  })

  test('an Expense kept from an older server has no Receipt No. to send back, so the edit never wipes one', () => {
    const { receiptNumber: _, ...older } = expense
    const draft = { ...draftFromExpense(older), note: 'tablets' }

    expect(draft.receiptNumber).toBeUndefined()
    expect(toUpdateInput(draft, expense.id)).not.toHaveProperty('receiptNumber')
    expect(toUpdateInput({ ...draft, receiptNumber: ' 77 ' }, expense.id).receiptNumber).toBe('77')
  })
})

describe('toUpdateInput', () => {
  test('sends the ID and every editable field, never Logged By or the Receipt file', () => {
    const draft = { ...draftFromExpense(expense), amount: 500, note: '  tablets  ', reimbursementStatus: 'pending' as const, receiptNumber: ' 0045 ' }

    expect(toUpdateInput(draft, expense.id)).toEqual({
      id: expense.id,
      expenseDate: '2026-10-30',
      paidBy: 'kid1',
      amount: 500,
      category: 'Medical & Pharmacy',
      merchantNote: 'tablets',
      paymentMethod: 'Cash',
      reimbursementStatus: 'pending',
      receiptNumber: '0045',
    })
  })

  test('a cleared Receipt No. is sent blank, so the Ledger cell is emptied', () => {
    expect(toUpdateInput({ ...draftFromExpense(expense), receiptNumber: '' }, expense.id).receiptNumber).toBe('')
  })
})
