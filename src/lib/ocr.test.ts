import { describe, expect, test } from 'vitest'
import { ApiError, type Category, type Member } from './api'
import { LOW_CONFIDENCE, ocrFailureNotice, prefillFromOcr, readReceipt, type OcrResult } from './ocr'
import { newDraft } from './quickExpense'

const today = '2026-10-31'

const ramesh: Member = {
  memberId: 'ramesh',
  name: 'Ramesh',
  role: 'parent',
  defaultPaymentMethod: 'Cash',
  pinHash: null,
  avatarColor: '#6E7250',
}

const category = (name: string, emoji: string): Category => ({ name, emoji, colorHex: '#6E7250', monthlyBudgetLimit: 0, visibleToRoles: ['all'] })
const categories: Category[] = [
  category('Groceries & Vegetables', '🥬'),
  category('Medical & Pharmacy', '💊'),
  category('Utilities & Bills', '💡'),
  category('Other', '📦'),
]

/** What `ocr` answers for a clear pharmacy bill paid by UPI (the Go test's `pharmacyBill`). */
const pharmacyBill: OcrResult = {
  merchant: 'Apollo Pharmacy',
  expenseDate: '2026-10-30',
  totalAmount: 450,
  taxAmount: 21.43,
  currency: 'INR',
  category: 'Medical & Pharmacy',
  paymentMethod: 'UPI',
  confidence: { merchant: 0.95, expenseDate: 0.9, totalAmount: 0.97, category: 0.88, paymentMethod: 0.92 },
  lineItemSummary: 'paracetamol, cough syrup, bandages',
  model: 'gemini-3.5-flash-lite',
}

const base = newDraft(ramesh, today)
const prefill = (result: OcrResult, cats = categories) => prefillFromOcr(result, base, cats, today)

describe('prefillFromOcr', () => {
  test('a clear receipt fills amount, Category, Payment Method, date and note, and highlights nothing', () => {
    const { draft, highlight } = prefill(pharmacyBill)

    expect(draft).toEqual({
      ...base,
      amount: 450,
      category: 'Medical & Pharmacy',
      paymentMethod: 'UPI',
      expenseDate: '2026-10-30',
      note: 'Apollo Pharmacy: paracetamol, cough syrup, bandages',
    })
    expect(highlight).toEqual({})
  })

  test('fields the model is less than 0.6 sure of are highlighted, and still filled', () => {
    const { draft, highlight } = prefill({
      ...pharmacyBill,
      confidence: { merchant: 0.59, expenseDate: 0.2, totalAmount: 0.5, category: 0.6, paymentMethod: 0.4 },
    })

    expect(LOW_CONFIDENCE).toBe(0.6)
    expect(draft.amount).toBe(450)
    expect(draft.expenseDate).toBe('2026-10-30')
    expect(draft.paymentMethod).toBe('UPI')
    expect(highlight).toEqual({ amount: true, expenseDate: true, paymentMethod: true, note: true })
  })

  test('what the receipt does not show keeps the blank form value and is highlighted', () => {
    const { draft, highlight } = prefill({
      merchant: null,
      expenseDate: null,
      totalAmount: null,
      taxAmount: null,
      currency: null,
      category: 'Other',
      paymentMethod: null,
      confidence: { merchant: 0, expenseDate: 0, totalAmount: 0, category: 0.3, paymentMethod: 0 },
      lineItemSummary: '',
      model: 'gemini-3.5-flash-lite',
    })

    expect(draft).toEqual({ ...base, category: 'Other' })
    expect(highlight).toEqual({ amount: true, category: true, expenseDate: true, paymentMethod: true, note: true })
  })

  test('a missing Payment Method keeps the Member default, highlighted even when the model was sure', () => {
    const { draft, highlight } = prefill({ ...pharmacyBill, paymentMethod: null, confidence: { ...pharmacyBill.confidence, paymentMethod: 0.9 } })

    expect(draft.paymentMethod).toBe('Cash')
    expect(highlight).toEqual({ paymentMethod: true })
  })

  test('a Category the Member cannot see, or the Household renamed, is left unpicked and highlighted', () => {
    const { draft, highlight } = prefill({ ...pharmacyBill, category: 'Dining & Outings' })

    expect(draft.category).toBeNull()
    expect(highlight).toEqual({ category: true })
  })

  test('the Category is matched ignoring case and spaces, in the Ledger spelling', () => {
    const { draft } = prefill(pharmacyBill, [category('medical  &  pharmacy', '💊')])

    expect(draft.category).toBe('medical  &  pharmacy')
  })

  test('a date after tomorrow is a misread: today stays, highlighted', () => {
    const { draft, highlight } = prefill({ ...pharmacyBill, expenseDate: '2027-10-30' })

    expect(draft.expenseDate).toBe(today)
    expect(highlight).toEqual({ expenseDate: true })
  })

  test('tomorrow is allowed, as the form allows it', () => {
    expect(prefill({ ...pharmacyBill, expenseDate: '2026-11-01' }).draft.expenseDate).toBe('2026-11-01')
  })

  test('paise are kept to two decimals; zero or over a crore is not an amount', () => {
    expect(prefill({ ...pharmacyBill, totalAmount: 1234.5 }).draft.amount).toBe(1234.5)
    expect(prefill({ ...pharmacyBill, totalAmount: 99.999 }).draft.amount).toBe(100)
    for (const totalAmount of [0, 10_000_001]) {
      const { draft, highlight } = prefill({ ...pharmacyBill, totalAmount })
      expect(draft.amount).toBe(0)
      expect(highlight).toEqual({ amount: true })
    }
  })

  test('a total in another currency is filled but highlighted: the Ledger is rupees', () => {
    const { draft, highlight } = prefill({ ...pharmacyBill, currency: 'USD', totalAmount: 12.5 })

    expect(draft.amount).toBe(12.5)
    expect(highlight).toEqual({ amount: true })
  })

  test('the note is the merchant, the line items, or both', () => {
    expect(prefill({ ...pharmacyBill, lineItemSummary: '' }).draft.note).toBe('Apollo Pharmacy')
    expect(prefill({ ...pharmacyBill, merchant: null }).draft.note).toBe('paracetamol, cough syrup, bandages')
    expect(prefill({ ...pharmacyBill, merchant: '  ', lineItemSummary: '  ' }).draft.note).toBe('')
  })

  test('the note never exceeds the 500 characters the form allows', () => {
    expect(prefill({ ...pharmacyBill, lineItemSummary: 'x'.repeat(600) }).draft.note).toHaveLength(500)
  })

  test('the Member, "own pocket" and anything else in the base draft are kept', () => {
    const own = { ...base, reimbursementStatus: 'pending' as const, paidBy: 'ramesh' }

    const { draft } = prefillFromOcr(pharmacyBill, own, categories, today)

    expect(draft.reimbursementStatus).toBe('pending')
    expect(draft.paidBy).toBe('ramesh')
  })
})

describe('readReceipt', () => {
  test('posts the Drive file ID to /api/ocr and returns the fields', async () => {
    const seen: { url: string; init?: RequestInit }[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init })
      return Response.json(pharmacyBill)
    }

    const result = await readReceipt('file-1', fetchImpl)

    expect(result).toEqual(pharmacyBill)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('/api/ocr')
    expect(seen[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ fileId: 'file-1' })
  })

  test('a refusal is an ApiError with the server code', async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ code: 'OCR_BLOCKED', message: 'Gemini did not finish reading this receipt (SAFETY)' }, { status: 422 })

    await expect(readReceipt('file-1', fetchImpl)).rejects.toMatchObject({ status: 422, code: 'OCR_BLOCKED' })
  })
})

describe('ocrFailureNotice', () => {
  test('is one line that says the form is the user’s to fill', () => {
    const notices = [
      ocrFailureNotice(new ApiError(422, 'OCR_INVALID', 'The receipt could not be read: missing taxAmount')),
      ocrFailureNotice(new ApiError(502, 'GEMINI_ERROR', 'gemini: 429')),
      ocrFailureNotice(new TypeError('Failed to fetch')),
    ]
    for (const n of notices) {
      expect(n).toBe('Could not read the receipt. Please fill in the details.')
    }
  })

  test('says so when the server has no Gemini key yet', () => {
    expect(ocrFailureNotice(new ApiError(500, 'SERVER_MISCONFIGURED', 'GEMINI_API_KEY is not set'))).toBe(
      'Receipt reading is not set up yet. Please fill in the details.',
    )
  })
})
