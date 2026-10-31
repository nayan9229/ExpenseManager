/**
 * Admin Mode's lock (user stories 11 and 12, ADR-0002): the PIN is asked on
 * every entry, and five minutes in the background returns the device to
 * Simple Mode for the last non-Admin Member, or to the switcher.
 *
 * An Admin is therefore never the Member a device remembers between loads.
 */
import type { Member } from './api'

export const ADMIN_BACKGROUND_LIMIT_MS = 5 * 60 * 1000

/**
 * Times trips to the background (`visibilitychange`). `visible` answers
 * whether the app was away long enough that Admin Mode must close.
 */
export function backgroundTimer(limitMs: number = ADMIN_BACKGROUND_LIMIT_MS) {
  let hiddenAt: number | null = null
  return {
    hidden(now: number): void {
      if (hiddenAt === null) hiddenAt = now
    },
    visible(now: number): boolean {
      const away = hiddenAt === null ? 0 : now - hiddenAt
      hiddenAt = null
      return away >= limitMs
    },
  }
}

/** Who the device returns to when Admin Mode closes: the last non-Admin Member, or nobody (the switcher). */
export function memberAfterAdmin(members: Member[], lastNonAdminId: string | null): Member | null {
  const member = members.find((m) => m.memberId === lastNonAdminId)
  return member && member.role !== 'admin' ? member : null
}

/**
 * Who the app opens as: the remembered Member, unless that is an Admin
 * (whose PIN must be typed again) or no longer in the Ledger.
 */
export function startingMember(members: Member[], rememberedId: string | null): Member | null {
  return memberAfterAdmin(members, rememberedId)
}
