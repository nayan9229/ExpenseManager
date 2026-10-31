import { describe, expect, test } from 'vitest'
import { ApiError, deleteExpense, updateExpense, type Expense } from './api'

const stored: Expense = {
  id: '0b8a3c2e-5f4d-4e61-8a9b-7c6d5e4f3a21',
  createdAt: '2026-10-30T20:00:00+05:30',
  updatedAt: '2026-10-31T09:15:00+05:30',
  expenseDate: '2026-10-29',
  loggedBy: 'ramesh',
  paidBy: 'kid1',
  amount: 540.5,
  currency: 'INR',
  category: 'Groceries & Vegetables',
  merchantNote: 'vegetables',
  paymentMethod: 'UPI',
  driveFileId: '',
  driveViewUrl: '',
  fileHash: '',
  reimbursementStatus: 'pending',
  status: 'active',
}

type Seen = { method: string; url: string; body: unknown }

function fakeExpenses(status: number, body: unknown, seen: Seen[]): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    if (!url.startsWith('/api/expenses')) throw new Error(`unexpected request to ${url}`)
    seen.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return Response.json(body, { status })
  }
}

describe('updateExpense', () => {
  test('PUTs the ID and the edited fields and returns the stored Expense', async () => {
    const seen: Seen[] = []
    const edit = { id: stored.id, amount: 540.5, reimbursementStatus: 'pending' as const }

    const expense = await updateExpense(edit, fakeExpenses(200, stored, seen))

    expect(expense).toEqual(stored)
    expect(seen).toEqual([{ method: 'PUT', url: '/api/expenses', body: edit }])
  })

  test('an Expense deleted elsewhere surfaces as EXPENSE_NOT_FOUND', async () => {
    const call = updateExpense({ id: stored.id }, fakeExpenses(404, { code: 'EXPENSE_NOT_FOUND', message: 'gone' }, []))
    await expect(call).rejects.toMatchObject({ status: 404, code: 'EXPENSE_NOT_FOUND' })
    await expect(call).rejects.toBeInstanceOf(ApiError)
  })
})

describe('deleteExpense', () => {
  test('DELETEs by ID in the query and returns the Expense marked deleted', async () => {
    const seen: Seen[] = []

    const expense = await deleteExpense(stored.id, fakeExpenses(200, { ...stored, status: 'deleted' }, seen))

    expect(expense.status).toBe('deleted')
    expect(seen).toEqual([{ method: 'DELETE', url: `/api/expenses?id=${stored.id}`, body: null }])
  })

  test('the ID is encoded, so a hand-typed ID with spaces still reaches the server', async () => {
    const seen: Seen[] = []

    await deleteExpense('row 7&x', fakeExpenses(200, stored, seen))

    expect(seen[0]?.url).toBe('/api/expenses?id=row+7%26x')
  })
})
