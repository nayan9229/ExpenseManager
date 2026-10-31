/**
 * OCR prefill (spec "OCR", pipeline step 7; user stories 29 to 31, 33):
 * once the Receipt is in Drive, `ocr` reads it with Gemini, and the answer
 * becomes the form's starting values. Nothing is ever saved from it: the
 * parent sees and confirms the form. Fields the model was unsure of, or
 * could not fill, are highlighted.
 */
import { ApiError, readJson, type Category, type PaymentMethod } from './api'
import { addDays } from './istDate'
import { MAX_AMOUNT } from './keypad'
import type { ExpenseDraft } from './quickExpense'

/** What the `ocr` function answers; null where the Receipt did not show it. */
export type OcrResult = {
  merchant: string | null
  expenseDate: string | null
  totalAmount: number | null
  taxAmount: number | null
  currency: string | null
  /** One of the seven seeded Categories. */
  category: string
  paymentMethod: PaymentMethod | null
  /** The model's 0..1 estimate per field. */
  confidence: { merchant: number; expenseDate: number; totalAmount: number; category: number; paymentMethod: number }
  /** About five words on what was bought. */
  lineItemSummary: string
  model: string
}

/** Fields of the form to draw the eye to. */
export type Highlight = Partial<Record<keyof ExpenseDraft, boolean>>

/** Under this the model's answer is highlighted (spec "Receipt pipeline", step 7). */
export const LOW_CONFIDENCE = 0.6

/** The note field's limit (ExpenseForm `maxLength`). */
const NOTE_MAX = 500

/** Reads the uploaded Receipt `fileId`. OCR can take 10 to 30 s. */
export async function readReceipt(fileId: string, fetchImpl: typeof fetch = fetch): Promise<OcrResult> {
  const res = await fetchImpl('/api/ocr', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ fileId }),
  })
  return readJson<OcrResult>(res)
}

const sameName = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The form's starting values from an OCR answer, over `base` (the blank
 * draft: the Member's Payment Method, today, "own pocket" off). `categories`
 * are the ones this Member can pick. A value that cannot be used (missing,
 * a Category not on the grid, a date after tomorrow, no amount) keeps the
 * base value and is highlighted, like a low-confidence one.
 */
export function prefillFromOcr(result: OcrResult, base: ExpenseDraft, categories: Category[], today: string): { draft: ExpenseDraft; highlight: Highlight } {
  const draft: ExpenseDraft = { ...base }
  const highlight: Highlight = {}
  const unsure = (score: number) => !(score >= LOW_CONFIDENCE)

  const amount = result.totalAmount === null ? 0 : Math.round(result.totalAmount * 100) / 100
  const usableAmount = amount > 0 && amount <= MAX_AMOUNT
  if (usableAmount) draft.amount = amount
  if (!usableAmount || unsure(result.confidence.totalAmount) || (result.currency !== null && result.currency !== 'INR')) {
    highlight.amount = true
  }

  const match = categories.find((c) => sameName(c.name, result.category))
  if (match) draft.category = match.name
  if (!match || unsure(result.confidence.category)) highlight.category = true

  if (result.paymentMethod) draft.paymentMethod = result.paymentMethod
  if (!result.paymentMethod || unsure(result.confidence.paymentMethod)) highlight.paymentMethod = true

  const date = result.expenseDate
  const usableDate = date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= addDays(today, 1)
  if (usableDate) draft.expenseDate = date
  if (!usableDate || unsure(result.confidence.expenseDate)) highlight.expenseDate = true

  const merchant = result.merchant?.trim() ?? ''
  const items = result.lineItemSummary.trim()
  const note = [merchant, items].filter(Boolean).join(': ').slice(0, NOTE_MAX)
  if (note) draft.note = note
  if (!merchant || unsure(result.confidence.merchant)) highlight.note = true

  return { draft, highlight }
}

/** The one line shown when OCR failed; the form stays empty and the Receipt stays attached. */
export function ocrFailureNotice(err: unknown): string {
  if (err instanceof ApiError && err.code === 'SERVER_MISCONFIGURED') return 'Receipt reading is not set up yet. Please fill in the details.'
  return 'Could not read the receipt. Please fill in the details.'
}
