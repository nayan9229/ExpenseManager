/**
 * Client-side PIN verification (ADR-0002). The server returns each Member's
 * `pinHash` = hex SHA-256 of `${memberId}:${pin}` and never the PIN; the
 * device checks a typed PIN against it, so switching Members works offline.
 */

/** Hex SHA-256 of `${memberId}:${pin}`, the same digest the server computes. */
export async function hashPin(memberId: string, pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${memberId}:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Whether `pin` is the Member's PIN. A Member with no PIN set (`pinHash`
 * null) never verifies: the app must not let anyone in as an Admin whose
 * PIN is blank.
 */
export async function verifyPin(member: { memberId: string; pinHash: string | null }, pin: string): Promise<boolean> {
  if (member.pinHash === null) return false
  return (await hashPin(member.memberId, pin)) === member.pinHash
}
