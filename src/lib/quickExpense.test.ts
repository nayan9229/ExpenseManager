import { describe, expect, test } from 'vitest'
import type { Category, Expense, Member } from './api'
import { draftProblem, findDuplicate, lastFive, newDraft, newExpenseId, toCreateInput, visibleCategories } from './quickExpense'

const category = (name: string, visibleToRoles: string[]): Category => ({
  name,
  emoji: '📦',
  colorHex: '#6E7250',
  monthlyBudgetLimit: 0,
  visibleToRoles,
})

const categories = [
  category('Groceries & Vegetables', ['all']),
  category('Medical & Pharmacy', ['admin', 'parent']),
  category('School & Kids', ['kid']),
  category('Rent', ['admin']),
]

const ramesh: Member = {
  memberId: 'ramesh',
  name: 'Ramesh',
  role: 'parent',
  defaultPaymentMethod: 'Cash',
  pinHash: null,
  avatarColor: '#A98545',
}

function expense(over: Partial<Expense>): Expense {
  return {
    id: 'e',
    createdAt: '2026-10-30T10:00:00+05:30',
    updatedAt: '2026-10-30T10:00:00+05:30',
    expenseDate: '2026-10-30',
    loggedBy: 'ramesh',
    paidBy: 'ramesh',
    amount: 450,
    currency: 'INR',
    category: 'Medical & Pharmacy',
    merchantNote: '',
    paymentMethod: 'Cash',
    driveFileId: '',
    driveViewUrl: '',
    fileHash: '',
    reimbursementStatus: 'none',
    status: 'active',
    ...over,
  }
}

describe('visibleCategories', () => {
  test('a Role sees the Categories open to all plus the ones naming it, in Ledger order', () => {
    expect(visibleCategories(categories, 'kid').map((c) => c.name)).toEqual(['Groceries & Vegetables', 'School & Kids'])
    expect(visibleCategories(categories, 'parent').map((c) => c.name)).toEqual(['Groceries & Vegetables', 'Medical & Pharmacy'])
    expect(visibleCategories(categories, 'admin').map((c) => c.name)).toEqual([
      'Groceries & Vegetables',
      'Medical & Pharmacy',
      'Rent',
    ])
  })

  test('the Category an Expense already has stays on the grid even when hidden from the Role', () => {
    expect(visibleCategories(categories, 'kid', 'Rent').map((c) => c.name)).toEqual([
      'Groceries & Vegetables',
      'School & Kids',
      'Rent',
    ])
  })
})

describe('findDuplicate', () => {
  const window = [
    expense({ id: 'a', amount: 450, category: 'Medical & Pharmacy', expenseDate: '2026-10-30', loggedBy: 'sita' }),
    expense({ id: 'b', amount: 450, category: 'Medical & Pharmacy', expenseDate: '2026-10-29' }),
    expense({ id: 'gone', amount: 99, category: 'Other', expenseDate: '2026-10-30', status: 'deleted' }),
  ]

  test('finds an Expense with the same amount, Category and date, whoever logged it', () => {
    expect(findDuplicate(window, { amount: 450, category: 'Medical & Pharmacy', expenseDate: '2026-10-30' })?.id).toBe('a')
  })

  test('a different amount, Category or date is not a duplicate', () => {
    expect(findDuplicate(window, { amount: 451, category: 'Medical & Pharmacy', expenseDate: '2026-10-30' })).toBeNull()
    expect(findDuplicate(window, { amount: 450, category: 'Other', expenseDate: '2026-10-30' })).toBeNull()
    expect(findDuplicate(window, { amount: 450, category: 'Medical & Pharmacy', expenseDate: '2026-10-28' })).toBeNull()
  })

  test('deleted Expenses and the Expense being edited do not count', () => {
    expect(findDuplicate(window, { amount: 99, category: 'Other', expenseDate: '2026-10-30' })).toBeNull()
    expect(findDuplicate(window, { amount: 450, category: 'Medical & Pharmacy', expenseDate: '2026-10-30' }, 'a')).toBeNull()
  })
})

describe('lastFive', () => {
  test("is the Member's own five newest active Expenses, newest date then newest created", () => {
    const all = [
      expense({ id: 'old', expenseDate: '2026-10-01' }),
      expense({ id: 'other-member', expenseDate: '2026-10-31', loggedBy: 'sita' }),
      expense({ id: 'deleted', expenseDate: '2026-10-31', status: 'deleted' }),
      expense({ id: 'oct30-am', expenseDate: '2026-10-30', createdAt: '2026-10-30T08:00:00+05:30' }),
      expense({ id: 'oct30-pm', expenseDate: '2026-10-30', createdAt: '2026-10-30T20:00:00+05:30' }),
      expense({ id: 'oct29', expenseDate: '2026-10-29' }),
      expense({ id: 'oct31', expenseDate: '2026-10-31' }),
      expense({ id: 'oct28', expenseDate: '2026-10-28' }),
    ]

    expect(lastFive(all, 'ramesh').map((e) => e.id)).toEqual(['oct31', 'oct30-pm', 'oct30-am', 'oct29', 'oct28'])
  })
})

describe('newDraft', () => {
  test("starts empty, dated today, paid the Member's usual way, by the Member, no Reimbursement", () => {
    expect(newDraft(ramesh, '2026-10-31')).toEqual({
      amount: 0,
      category: null,
      paymentMethod: 'Cash',
      expenseDate: '2026-10-31',
      note: '',
      reimbursementStatus: 'none',
      paidBy: 'ramesh',
    })
  })
})

describe('draftProblem', () => {
  const ok = { ...newDraft(ramesh, '2026-10-31'), amount: 450, category: 'Medical & Pharmacy' }

  test('a draft with an amount and a Category can be saved', () => {
    expect(draftProblem(ok, '2026-10-31')).toBeNull()
  })

  test('says what is missing in plain words', () => {
    expect(draftProblem({ ...ok, amount: 0 }, '2026-10-31')).toBe('Enter the amount')
    expect(draftProblem({ ...ok, category: null }, '2026-10-31')).toBe('Pick a Category')
    expect(draftProblem({ ...ok, expenseDate: '' }, '2026-10-31')).toBe('Pick a date')
    expect(draftProblem({ ...ok, expenseDate: '2026-11-02' }, '2026-10-31')).toBe('The date cannot be after tomorrow')
  })
})

describe('toCreateInput', () => {
  test('maps the draft onto what the server expects, the note trimmed', () => {
    const draft = {
      ...newDraft(ramesh, '2026-10-31'),
      amount: 450,
      category: 'Medical & Pharmacy',
      note: '  medicines for Papa ',
      reimbursementStatus: 'pending' as const,
    }

    expect(toCreateInput(draft, 'ramesh', 'id-1')).toEqual({
      id: 'id-1',
      expenseDate: '2026-10-31',
      loggedBy: 'ramesh',
      paidBy: 'ramesh',
      amount: 450,
      category: 'Medical & Pharmacy',
      merchantNote: 'medicines for Papa',
      paymentMethod: 'Cash',
      reimbursementStatus: 'pending',
    })
  })
})

describe('newExpenseId', () => {
  test('is a lower-case UUID, different every time', () => {
    const a = newExpenseId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(newExpenseId()).not.toBe(a)
  })
})
