/**
 * Pure helpers for Pairing by Pair Token (GLOSSARY: Pair Token, Pair Code,
 * Gatekeeper). Browser glue (history, the install prompt) lives in the
 * screens and `installPrompt.ts`; everything here takes plain values.
 */

/**
 * Splits the QR link's `pairToken` off an address. `cleanUrl` is the same
 * address (path, other query parameters, hash) without it, ready for
 * `history.replaceState`, so the code does not linger in the address bar or
 * the history.
 */
export function pairTokenFromUrl(href: string): { token: string | null; cleanUrl: string } {
  const url = new URL(href)
  const token = url.searchParams.get('pairToken')
  url.searchParams.delete('pairToken')
  return { token: token ? token : null, cleanUrl: url.pathname + url.search + url.hash }
}

/** Characters in a Pair Code. */
export const PAIR_CODE_LENGTH = 8

/**
 * What the server will compare (pkg/paircode.Normalise): upper case, no
 * spaces or dashes, look-alikes O, I and L as 0 and 1 (Crockford base32 has
 * no O, I, L or U), at most eight characters.
 */
export function normalisePairCode(typed: string): string {
  return typed
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, PAIR_CODE_LENGTH)
}

/** A Pair Code as people read it: `XXXX-XXXX`, also while half typed. */
export function formatPairCode(typed: string): string {
  const code = normalisePairCode(typed)
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

/**
 * Time left on a Pair Code for the pairing modal's countdown. `expiresAt` is
 * the `pair-token` response's RFC 3339 expiry; a part second rounds up so
 * the label reaches 0:00 exactly when the code stops working.
 */
export function countdown(expiresAt: string, nowMs: number): { secondsLeft: number; label: string; expired: boolean } {
  const end = Date.parse(expiresAt)
  const secondsLeft = Number.isNaN(end) ? 0 : Math.max(0, Math.ceil((end - nowMs) / 1000))
  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, '0')
  return { secondsLeft, label: `${minutes}:${seconds}`, expired: secondsLeft === 0 }
}

/**
 * Which install guidance the Gatekeeper shows
 * (docs/research/mobile-browser-capabilities.md, question 6):
 * - `installed`: already running from the home screen; nothing to install.
 * - `ios-safari`: Share, then "Add to Home Screen" (iOS has no install prompt).
 * - `ios-other-browser`: Chrome, Firefox or an in-app browser on iOS; the
 *   steps are the same from Safari, so point there.
 * - `android`: an Install button when the browser offers `beforeinstallprompt`,
 *   otherwise the browser menu.
 * - `other`: a desktop; no guidance.
 *
 * `standalone` is `navigator.standalone` (iOS) or the
 * `(display-mode: standalone)` media query.
 */
export type InstallPlatform = 'installed' | 'ios-safari' | 'ios-other-browser' | 'android' | 'other'

export function installPlatform(env: { userAgent: string; maxTouchPoints: number; standalone: boolean }): InstallPlatform {
  if (env.standalone) return 'installed'
  const ua = env.userAgent
  // iPadOS 13+ Safari reports a Mac; only the touch screen gives it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1)
  if (ios) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) || !/Safari\//.test(ua)
    return otherBrowser ? 'ios-other-browser' : 'ios-safari'
  }
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

/**
 * Whether Simple Mode shows the "Add to Home Screen" steps (spec "Simple
 * Mode": install guidance on first launch in Safari; another iOS browser is
 * pointed to Safari, as in the Gatekeeper). A device paired in
 * iPhone Safari (a scanned QR link opens there) would otherwise never be
 * told to install; the steps stay until the Member dismisses them on this
 * device or opens the app from the Home Screen.
 */
export function showsInstallHintInSimpleMode(state: { platform: InstallPlatform; dismissed: boolean }): boolean {
  const ios = state.platform === 'ios-safari' || state.platform === 'ios-other-browser'
  return ios && !state.dismissed
}
