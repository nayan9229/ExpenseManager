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

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** What the `auth` GET reports: whether this device holds a valid Session. */
export type SessionState = {
  paired: boolean
}

type ErrorEnvelope = { code?: unknown; message?: unknown }

async function readJson<T>(res: Response): Promise<T> {
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

/** What the `expenses` GET returns: everything a device needs to start. */
export type ReadModel = {
  /** Empty until ticket 04 reads the date window. */
  expenses: unknown[]
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

/** Loads the read model from the `expenses` function. */
export async function getReadModel(fetchImpl: typeof fetch = fetch): Promise<ReadModel> {
  const res = await fetchImpl('/api/expenses', {
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
