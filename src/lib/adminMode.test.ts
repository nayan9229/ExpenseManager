import { describe, expect, test } from 'vitest'
import type { Category, Expense, Member, RecurringRule } from './api'
import { breakdown, burnRates, dueNotLogged, mergeExpenses, paidByMember, prefillFromRule, reimbursableQueue, repairSummary, repairWarnings } from './adminMode'

const category = (name: string, monthlyBudgetLimit: number, emoji = '📦'): Category => ({
  name,
  emoji,
  colorHex: '#6E7250',
  monthlyBudgetLimit,
  visibleToRoles: ['all'],
})

let seq = 0
function expense(over: Partial<Expense>): Expense {
  seq += 1
  return {
    id: `e${seq}`,
    createdAt: '2026-10-30T10:00:00+05:30',
    updatedAt: '2026-10-30T10:00:00+05:30',
    expenseDate: '2026-10-30',
    loggedBy: 'ramesh',
    paidBy: 'ramesh',
    amount: 450,
    currency: 'INR',
    category: 'Groceries & Vegetables',
    merchantNote: '',
    paymentMethod: 'UPI',
    driveFileId: '',
    driveViewUrl: '',
    fileHash: '',
    reimbursementStatus: 'none',
    status: 'active',
    ...over,
  }
}

const categories = [
  category('Groceries & Vegetables', 10000, '🥬'),
  category('Medical & Pharmacy', 2000, '💊'),
  category('Other', 0),
]

describe('burnRates', () => {
  test('each Category with a Budget gets its spend as a fraction of that Budget', () => {
    const burn = burnRates(categories, [
      expense({ category: 'Groceries & Vegetables', amount: 2500 }),
      expense({ category: 'Groceries & Vegetables', amount: 1500.5 }),
      expense({ category: 'Medical & Pharmacy', amount: 500 }),
    ])
    expect(burn.categories.map((c) => [c.name, c.spent, c.budget, c.fraction, c.over])).toEqual([
      ['Groceries & Vegetables', 4000.5, 10000, 0.40005, false],
      ['Medical & Pharmacy', 500, 2000, 0.25, false],
      ['Other', 0, 0, null, false],
    ])
  })

  test('a Category with Budget 0 shows its total but no bar', () => {
    const other = burnRates(categories, [expense({ category: 'Other', amount: 999 })]).categories.find((c) => c.name === 'Other')
    expect(other).toMatchObject({ spent: 999, budget: 0, fraction: null, over: false })
  })

  test('spend above the Budget is over; spend exactly at the Budget is not', () => {
    const burn = burnRates(categories, [
      expense({ category: 'Medical & Pharmacy', amount: 2000.01 }),
      expense({ category: 'Groceries & Vegetables', amount: 10000 }),
    ])
    expect(burn.categories.find((c) => c.name === 'Medical & Pharmacy')).toMatchObject({ over: true })
    expect(burn.categories.find((c) => c.name === 'Groceries & Vegetables')).toMatchObject({ fraction: 1, over: false })
  })

  test('the Household bar compares every rupee spent with the sum of the Budgets', () => {
    const burn = burnRates(categories, [
      expense({ category: 'Groceries & Vegetables', amount: 6000 }),
      expense({ category: 'Other', amount: 7000 }),
    ])
    expect(burn.household).toEqual({ spent: 13000, budget: 12000, fraction: 13000 / 12000, over: true })
  })

  test('with no Budgets at all the Household shows its total without a bar', () => {
    const burn = burnRates([category('Other', 0)], [expense({ category: 'Other', amount: 100 })])
    expect(burn.household).toEqual({ spent: 100, budget: 0, fraction: null, over: false })
  })

  test('matches the Category however the Ledger spells it, and lists unknown ones at the end', () => {
    const burn = burnRates(categories, [
      expense({ category: '  medical & pharmacy ', amount: 300 }),
      expense({ category: 'Petrol', amount: 800 }),
    ])
    expect(burn.categories.find((c) => c.name === 'Medical & Pharmacy')?.spent).toBe(300)
    expect(burn.categories.at(-1)).toMatchObject({ name: 'Petrol', emoji: '📦', spent: 800, budget: 0, fraction: null })
  })

  test('ignores deleted Expenses and keeps paise exact', () => {
    const burn = burnRates(categories, [
      expense({ amount: 0.1 }),
      expense({ amount: 0.2 }),
      expense({ amount: 5000, status: 'deleted' }),
    ])
    expect(burn.categories[0]?.spent).toBe(0.3)
    expect(burn.categories[0]?.count).toBe(2)
  })
})

describe('paidByMember', () => {
  const mine = expense({ paidBy: 'mom', loggedBy: 'kid1', amount: 100 })
  const theirs = expense({ paidBy: 'ramesh', loggedBy: 'mom', amount: 200 })

  test('keeps the Expenses the Member paid for, whoever logged them', () => {
    expect(paidByMember([mine, theirs], 'mom')).toEqual([mine])
  })

  test('null means the whole Household', () => {
    expect(paidByMember([mine, theirs], null)).toEqual([mine, theirs])
  })
})

describe('breakdown', () => {
  test('lists the Categories with spend, largest first, with their share of the month', () => {
    const rows = breakdown(
      burnRates(categories, [
        expense({ category: 'Medical & Pharmacy', amount: 750 }),
        expense({ category: 'Groceries & Vegetables', amount: 250 }),
        expense({ category: 'Medical & Pharmacy', amount: 1000 }),
      ]),
    )
    expect(rows.map((r) => [r.name, r.spent, r.count, r.share])).toEqual([
      ['Medical & Pharmacy', 1750, 2, 0.875],
      ['Groceries & Vegetables', 250, 1, 0.125],
    ])
  })

  test('is empty for a month with nothing spent', () => {
    expect(breakdown(burnRates(categories, []))).toEqual([])
  })
})

const member = (memberId: string, name: string, role: Member['role'] = 'parent'): Member => ({
  memberId,
  name,
  role,
  defaultPaymentMethod: 'UPI',
  pinHash: null,
  avatarColor: '#6E7250',
})

describe('reimbursableQueue', () => {
  const members = [member('admin', 'Admin', 'admin'), member('mom', 'Mom'), member('kid1', 'Kiddo', 'kid')]

  test('groups the pending Expenses by the Member who paid, in Ledger order, with what each is owed', () => {
    const a = expense({ paidBy: 'kid1', amount: 120, reimbursementStatus: 'pending', expenseDate: '2026-10-12' })
    const b = expense({ paidBy: 'mom', amount: 450, reimbursementStatus: 'pending' })
    const c = expense({ paidBy: 'kid1', amount: 80.5, reimbursementStatus: 'pending', expenseDate: '2026-10-03' })
    const queue = reimbursableQueue([a, b, c], members)
    expect(queue.map((g) => [g.memberId, g.name, g.total, g.expenses.map((e) => e.id)])).toEqual([
      ['mom', 'Mom', 450, [b.id]],
      ['kid1', 'Kiddo', 200.5, [c.id, a.id]],
    ])
  })

  test('leaves out Expenses with nothing owed, already paid back, or deleted', () => {
    const queue = reimbursableQueue(
      [
        expense({ paidBy: 'mom', reimbursementStatus: 'none' }),
        expense({ paidBy: 'mom', reimbursementStatus: 'done' }),
        expense({ paidBy: 'mom', reimbursementStatus: 'pending', status: 'deleted' }),
      ],
      members,
    )
    expect(queue).toEqual([])
  })

  test('a payer no longer in the Members tab is listed last as Unknown', () => {
    const gone = expense({ paidBy: 'uncle', reimbursementStatus: 'pending', amount: 60 })
    const mom = expense({ paidBy: 'mom', reimbursementStatus: 'pending', amount: 40 })
    expect(reimbursableQueue([gone, mom], members).map((g) => [g.memberId, g.name])).toEqual([
      ['mom', 'Mom'],
      ['uncle', 'Unknown'],
    ])
  })
})

describe('mergeExpenses', () => {
  test('one copy per ID, the most recently updated one winning', () => {
    const old = expense({ id: 'x', updatedAt: '2026-10-30T10:00:00+05:30', reimbursementStatus: 'pending' })
    const fresh = { ...old, updatedAt: '2026-10-31T09:00:00+05:30', reimbursementStatus: 'done' as const }
    const other = expense({ id: 'y' })
    const merged = mergeExpenses([old, other], [fresh])
    expect(merged).toHaveLength(2)
    expect(merged.find((e) => e.id === 'x')?.reimbursementStatus).toBe('done')
    expect(mergeExpenses([fresh], [old]).find((e) => e.id === 'x')?.reimbursementStatus).toBe('done')
  })
})

const rule = (ruleId: string, category: string, dueDayOfMonth: number, amount = 1000, title = ruleId): RecurringRule => ({
  ruleId,
  title,
  amount,
  category,
  dueDayOfMonth,
})

describe('dueNotLogged', () => {
  const rent = rule('rent', 'Household & Help', 5, 25000, 'Rent')
  const fees = rule('fees', 'School & Kids', 10, 8000, 'School fee')
  const power = rule('power', 'Utilities & Bills', 31, 1800, 'Electricity')

  test('lists the Rules with no Expense in their Category that month, by due date', () => {
    const due = dueNotLogged([power, rent, fees], [expense({ category: 'School & Kids', expenseDate: '2026-10-02' })], '2026-10')
    expect(due.map((d) => [d.rule.ruleId, d.dueDate])).toEqual([
      ['rent', '2026-10-05'],
      ['power', '2026-10-31'],
    ])
  })

  test('an Expense in the same Category in another month does not count', () => {
    const due = dueNotLogged([rent], [expense({ category: 'Household & Help', expenseDate: '2026-09-05' })], '2026-10')
    expect(due.map((d) => d.rule.ruleId)).toEqual(['rent'])
  })

  test('a deleted Expense does not count, and the Category matches however it is spelt', () => {
    expect(dueNotLogged([rent], [expense({ category: 'Household & Help', expenseDate: '2026-10-05', status: 'deleted' })], '2026-10')).toHaveLength(1)
    expect(dueNotLogged([rent], [expense({ category: ' household & help', expenseDate: '2026-10-07' })], '2026-10')).toEqual([])
  })

  test('a due day past the end of a short month falls on its last day', () => {
    expect(dueNotLogged([power], [], '2026-02')[0]?.dueDate).toBe('2026-02-28')
    expect(dueNotLogged([power], [], '2026-11')[0]?.dueDate).toBe('2026-11-30')
  })
})

describe('prefillFromRule', () => {
  const categories = [category('Household & Help', 0)]
  const rent = rule('rent', 'household & help', 5, 25000, 'Rent')

  test('fills the amount, the Ledger spelling of the Category, the Rule title as the note, and the due date', () => {
    expect(prefillFromRule(rent, '2026-10-05', categories, '2026-10-31')).toEqual({
      amount: 25000,
      category: 'Household & Help',
      note: 'Rent',
      expenseDate: '2026-10-05',
    })
  })

  test('a due date still ahead is logged as today, since an Expense cannot be dated in the future', () => {
    expect(prefillFromRule(rent, '2026-10-31', categories, '2026-10-20').expenseDate).toBe('2026-10-20')
  })

  test('a Category the Ledger no longer has is left for the Admin to pick', () => {
    expect(prefillFromRule(rule('x', 'Petrol', 1), '2026-10-01', categories, '2026-10-31').category).toBeNull()
  })
})

describe('repairSummary', () => {
  const tabs = (created: string[] = []) =>
    Object.fromEntries(['Expenses', 'Members', 'Categories', 'Recurring_Rules'].map((t) => [t, { created: created.includes(t) }]))
  const seeded = (over: Record<string, number> = {}) => ({ Expenses: 0, Members: 0, Categories: 0, Recurring_Rules: 0, ...over })

  test('says nothing was missing when Bootstrap found everything', () => {
    expect(
      repairSummary({ receiptsFolder: { id: 'f', created: false }, ledger: { id: 'l', created: false }, tabs: tabs(), seeded: seeded() }),
    ).toEqual(['Nothing was missing. The Receipts folder, the Ledger and its four tabs are all there.'])
  })

  test('names each thing it recreated, in plain words', () => {
    expect(
      repairSummary({
        receiptsFolder: { id: 'f', created: true },
        ledger: { id: 'l', created: false },
        tabs: tabs(['Categories', 'Recurring_Rules']),
        seeded: seeded({ Categories: 7 }),
      }),
    ).toEqual([
      'Recreated the Receipts folder in Drive.',
      'Recreated the Categories tab.',
      'Recreated the Recurring Rules tab.',
      'Added 7 starter Categories.',
    ])
  })

  test('a brand new Ledger is reported once, with its seed rows', () => {
    expect(
      repairSummary({
        receiptsFolder: { id: 'f', created: false },
        ledger: { id: 'l', created: true },
        tabs: tabs(['Expenses', 'Members', 'Categories', 'Recurring_Rules']),
        seeded: seeded({ Members: 1, Categories: 7 }),
      }),
    ).toEqual(['Created a new Ledger with its four tabs.', 'Added 1 starter Member.', 'Added 7 starter Categories.'])
  })

  test('says which tabs got their headers back', () => {
    expect(
      repairSummary({
        receiptsFolder: { id: 'f', created: false },
        ledger: { id: 'l', created: false },
        tabs: tabs(),
        seeded: seeded(),
        headersWritten: ['Recurring_Rules', 'Expenses'],
        headerMismatches: [],
      }),
    ).toEqual(['Wrote the headers in row 1 of the Expenses tab.', 'Wrote the headers in row 1 of the Recurring Rules tab.'])
  })
})

describe('repairWarnings', () => {
  const report = {
    receiptsFolder: { id: 'f', created: false },
    ledger: { id: 'l', created: false },
    tabs: {},
    seeded: {},
  }

  test('a header Repair left alone is shown with the server message', () => {
    const message = 'Row 1 of the Members tab is not the expected header. Repair left it alone.'
    expect(
      repairWarnings({
        ...report,
        headersWritten: [],
        headerMismatches: [{ tab: 'Members', found: ['Member_ID', 'Full Name'], expected: ['Member_ID', 'Name'], message }],
      }),
    ).toEqual([message])
  })

  test('nothing to warn about, also from a server that predates the check', () => {
    expect(repairWarnings({ ...report, headersWritten: [], headerMismatches: [] })).toEqual([])
    expect(repairWarnings(report)).toEqual([])
  })
})
