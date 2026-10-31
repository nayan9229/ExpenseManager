/**
 * Typed client for the Go functions under /api.
 *
 * One function per endpoint so tests can hand in a fake `fetch` that returns
 * exactly one response shape. Every non-2xx body is the server's
 * `{ code, message }` envelope and is surfaced as an ApiError.
 */

/** Non-2xx response from a function. `code` is the server's machine-readable reason. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  /** The whole error body, for envelopes that carry more than `{ code, message }` (409 DUPLICATE_RECEIPT). */
  readonly body: unknown

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

/** What the `auth` GET reports: whether this device holds a valid Session. */
export type SessionState = {
  paired: boolean
}

type ErrorEnvelope = { code?: unknown; message?: unknown }

export async function readJson<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T
  let envelope: ErrorEnvelope = {}
  try {
    envelope = (await res.json()) as ErrorEnvelope
  } catch {
    // Non-JSON error body (e.g. a platform 502 page): fall through to defaults.
  }
  throw new ApiError(
    res.status,
    typeof envelope.code === 'string' ? envelope.code : 'HTTP_ERROR',
    typeof envelope.message === 'string' ? envelope.message : `Request failed with status ${res.status}`,
    envelope,
  )
}

/** Asks the `auth` function whether this device is paired. */
export async function getSessionState(fetchImpl: typeof fetch = fetch): Promise<SessionState> {
  const res = await fetchImpl('/api/auth', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  const body = await readJson<{ paired?: unknown }>(res)
  return { paired: body.paired === true }
}

/**
 * Pairs this device with the Household by sending the Access Code to the
 * `auth` function. A wrong code rejects with an ApiError whose `code` is
 * `WRONG_ACCESS_CODE` (after the server's deliberate delay). On success the
 * server has set the httpOnly Session cookie; nothing is stored client-side.
 */
export async function pairDevice(accessCode: string, fetchImpl: typeof fetch = fetch): Promise<SessionState> {
  const res = await fetchImpl('/api/auth', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ accessCode }),
  })
  const body = await readJson<{ paired?: unknown }>(res)
  return { paired: body.paired === true }
}

/**
 * Pairs this device with a Pair Code (typed in the Gatekeeper, or the
 * `pairToken` from the Admin's QR link). Same Session as the Access Code; a
 * stale or wrong code rejects with `WRONG_PAIR_CODE` after the delay.
 */
export async function pairWithCode(pairCode: string, fetchImpl: typeof fetch = fetch): Promise<SessionState> {
  const res = await fetchImpl('/api/auth', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ pairCode }),
  })
  const body = await readJson<{ paired?: unknown }>(res)
  return { paired: body.paired === true }
}

/** What `pair-token` returns: the current Pair Code, the QR link carrying it, and when it stops working (RFC 3339). */
export type PairToken = { pairCode: string; url: string; expiresAt: string }

/** Asks `pair-token` for the code the Admin's pairing modal shows. */
export async function getPairToken(fetchImpl: typeof fetch = fetch): Promise<PairToken> {
  const res = await fetchImpl('/api/pair-token', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  const body = await readJson<Partial<Record<keyof PairToken, unknown>>>(res)
  if (typeof body.pairCode !== 'string' || typeof body.url !== 'string' || typeof body.expiresAt !== 'string' || !body.pairCode) {
    throw new ApiError(res.status, 'BAD_RESPONSE', 'The server sent no Pair Code', body)
  }
  return { pairCode: body.pairCode, url: body.url, expiresAt: body.expiresAt }
}

/** A Member's permission tier (GLOSSARY: Role). */
export type Role = 'admin' | 'parent' | 'kid'

/** How an Expense was paid (GLOSSARY: Payment Method). */
export type PaymentMethod = 'UPI' | 'Cash' | 'Card' | 'Bank Transfer'

/** A Members row as the server returns it: a hash of the PIN, never the PIN. */
export type Member = {
  memberId: string
  name: string
  role: Role
  defaultPaymentMethod: PaymentMethod
  /** Hex SHA-256 of `${memberId}:${pin}`, or null when no PIN is set. */
  pinHash: string | null
  avatarColor: string
}

export type Category = {
  name: string
  emoji: string
  colorHex: string
  /** 0 means no Burn Rate bar. */
  monthlyBudgetLimit: number
  /** `['all']` or a subset of the roles. */
  visibleToRoles: string[]
}

export type RecurringRule = {
  ruleId: string
  title: string
  amount: number
  category: string
  dueDayOfMonth: number
}

/** What the Household owes a Member who paid from their own pocket. */
export type ReimbursementStatus = 'none' | 'pending' | 'done'

/** One Expenses row as the server returns it. */
export type Expense = {
  /** UUID generated on the device before the first send. */
  id: string
  /** ISO-8601 in IST, set by the server. */
  createdAt: string
  updatedAt: string
  /** `YYYY-MM-DD` (IST calendar date). */
  expenseDate: string
  /** Member IDs; an unknown one renders as "Unknown". */
  loggedBy: string
  paidBy: string
  /** Rupees, at most two decimals. */
  amount: number
  currency: 'INR'
  category: string
  merchantNote: string
  paymentMethod: PaymentMethod
  driveFileId: string
  driveViewUrl: string
  fileHash: string
  reimbursementStatus: ReimbursementStatus
  status: 'active' | 'deleted'
}

/** What a create sends: the Expense minus everything the server sets. */
export type CreateExpenseInput = Pick<
  Expense,
  'id' | 'expenseDate' | 'loggedBy' | 'paidBy' | 'amount' | 'category' | 'merchantNote' | 'paymentMethod' | 'reimbursementStatus'
> &
  ReceiptFields

/**
 * The Receipt half of a create (ticket 06): the uploaded file under its
 * temporary name, the SHA-256 of the original, and `force` to save past a
 * DUPLICATE_RECEIPT ("Add anyway").
 */
export type ReceiptFields = {
  driveFileId?: string
  fileHash?: string
  force?: boolean
}

/** The Expense that already holds this Receipt, when `err` is a 409 DUPLICATE_RECEIPT; otherwise null. */
export function duplicateReceiptOf(err: unknown): Expense | null {
  if (!(err instanceof ApiError) || err.status !== 409 || err.code !== 'DUPLICATE_RECEIPT') return null
  const expense = (err.body as { expense?: unknown } | undefined)?.expense
  return expense && typeof expense === 'object' ? (expense as Expense) : null
}

/** The answer to a create: the stored Expense, and whether it was already there. */
export type CreateExpenseResult = {
  expense: Expense
  /** True when the server already held this ID (a retried create): nothing was appended. */
  replayed: boolean
}

/** What the `expenses` GET returns: everything a device needs to start. */
export type ReadModel = {
  /** Active Expenses in the window (default 90 days back to tomorrow, IST), newest first. */
  expenses: Expense[]
  members: Member[]
  categories: Category[]
  recurringRules: RecurringRule[]
  ledgerUrl: string
  /** RFC 3339 in IST. */
  serverTime: string
}

/** One thing Bootstrap ensured. */
export type BootstrapItem = { id?: string; url?: string; created: boolean }

/** What the `bootstrap` POST returns: what was found versus created. */
export type BootstrapReport = {
  receiptsFolder: BootstrapItem
  ledger: BootstrapItem
  tabs: Record<string, BootstrapItem>
  seeded: Record<string, number>
}

/**
 * Runs Bootstrap: ensures the Receipt Store and the Ledger exist with their
 * tabs, headers and seed rows. Idempotent, so calling it again is harmless.
 */
export async function runBootstrap(fetchImpl: typeof fetch = fetch): Promise<BootstrapReport> {
  const res = await fetchImpl('/api/bootstrap', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  return readJson<BootstrapReport>(res)
}

/** An inclusive `YYYY-MM-DD` window; a missing end takes the server default. */
export type ExpenseWindow = { from?: string; to?: string }

/**
 * Loads the read model from the `expenses` function, optionally for a wider
 * or narrower date window than the default (Admin Mode's month view).
 */
export async function getReadModel(fetchImpl: typeof fetch = fetch, window: ExpenseWindow = {}): Promise<ReadModel> {
  const query = new URLSearchParams()
  if (window.from) query.set('from', window.from)
  if (window.to) query.set('to', window.to)
  const qs = query.toString()
  const res = await fetchImpl(qs ? `/api/expenses?${qs}` : '/api/expenses', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  const body = await readJson<Partial<ReadModel>>(res)
  return {
    expenses: Array.isArray(body.expenses) ? body.expenses : [],
    members: Array.isArray(body.members) ? body.members : [],
    categories: Array.isArray(body.categories) ? body.categories : [],
    recurringRules: Array.isArray(body.recurringRules) ? body.recurringRules : [],
    ledgerUrl: typeof body.ledgerUrl === 'string' ? body.ledgerUrl : '',
    serverTime: typeof body.serverTime === 'string' ? body.serverTime : '',
  }
}

/**
 * Creates an Expense. The `id` is generated once on the device, so sending
 * the same input again after a lost response is answered with the stored
 * row (200) instead of a second row.
 */
export async function createExpense(input: CreateExpenseInput, fetchImpl: typeof fetch = fetch): Promise<CreateExpenseResult> {
  const res = await fetchImpl('/api/expenses', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  })
  const expense = await readJson<Expense>(res)
  return { expense, replayed: res.status === 200 }
}

/**
 * What an edit sends: the ID plus the editable fields. A field left out
 * keeps its stored value, so "Mark done" can send only the Reimbursement.
 */
export type UpdateExpenseInput = Pick<Expense, 'id'> &
  Partial<Pick<Expense, 'expenseDate' | 'paidBy' | 'amount' | 'category' | 'merchantNote' | 'paymentMethod' | 'reimbursementStatus'>>

/**
 * Edits an Expense in place and returns it as stored (`updatedAt` stamped).
 * An Expense deleted meanwhile rejects with `EXPENSE_NOT_FOUND` (404).
 */
export async function updateExpense(input: UpdateExpenseInput, fetchImpl: typeof fetch = fetch): Promise<Expense> {
  const res = await fetchImpl('/api/expenses', {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  })
  return readJson<Expense>(res)
}

/**
 * Deletes an Expense (Soft Delete: the row stays in the Ledger marked
 * deleted) and returns it with `status: 'deleted'`. Deleting twice is
 * harmless; an unknown ID rejects with `EXPENSE_NOT_FOUND` (404).
 */
export async function deleteExpense(id: string, fetchImpl: typeof fetch = fetch): Promise<Expense> {
  const res = await fetchImpl(`/api/expenses?${new URLSearchParams({ id })}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  return readJson<Expense>(res)
}
