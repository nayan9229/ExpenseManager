import { describe, expect, test } from 'vitest'
import { createExpense, duplicateReceiptOf, type CreateExpenseInput, type Expense } from './api'

const input: CreateExpenseInput = {
  id: '6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10',
  expenseDate: '2026-10-30',
  loggedBy: 'ramesh',
  paidBy: 'ramesh',
  amount: 450,
  category: 'Medical & Pharmacy',
  merchantNote: 'medicines for Papa',
  paymentMethod: 'Cash',
  reimbursementStatus: 'none',
  driveFileId: 'drive-file-1',
  fileHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
}

const earlier: Expense = {
  ...input,
  id: '0b5c8f9e-1111-4c2a-9d55-0b9e1c3f7a10',
  expenseDate: '2026-10-29',
  amount: 1250,
  createdAt: '2026-10-29T19:00:00+05:30',
  updatedAt: '2026-10-29T19:00:00+05:30',
  currency: 'INR',
  driveFileId: 'file-earlier',
  driveViewUrl: 'https://drive.google.com/file/d/file-earlier/view',
  fileHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  status: 'active',
}

function answer(status: number, body: unknown, seen: unknown[] = []): typeof fetch {
  return async (_input, init) => {
    seen.push(JSON.parse(String(init?.body)))
    return Response.json(body, { status })
  }
}

describe('createExpense with a Receipt', () => {
  test('sends the Drive file ID, the hash and force', async () => {
    const seen: unknown[] = []

    await createExpense({ ...input, force: true }, answer(201, { ...earlier, ...input }, seen))

    expect(seen).toEqual([{ ...input, force: true }])
  })

  test('a 409 DUPLICATE_RECEIPT carries the Expense that already has this Receipt', async () => {
    const failure = await createExpense(
      input,
      answer(409, { code: 'DUPLICATE_RECEIPT', message: 'This receipt was already added on 2026-10-29 for ₹1250', expense: earlier }),
    ).catch((e: unknown) => e)

    expect(failure).toMatchObject({ status: 409, code: 'DUPLICATE_RECEIPT' })
    expect(duplicateReceiptOf(failure)).toEqual(earlier)
  })

  test('any other failure is not a duplicate', async () => {
    const failure = await createExpense(input, answer(422, { code: 'RECEIPT_NOT_IN_STORE', message: 'scan it again' })).catch((e: unknown) => e)

    expect(duplicateReceiptOf(failure)).toBeNull()
    expect(duplicateReceiptOf(new Error('offline'))).toBeNull()
  })
})
