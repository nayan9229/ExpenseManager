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
