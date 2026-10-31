/**
 * Moving to a new deploy (spec "PWA and service worker"; ticket 13).
 *
 * The service worker is generated with `registerType: 'autoUpdate'`, so a
 * new one skips waiting and claims this page as soon as it is installed;
 * the old shell's precache is cleaned up. From then on this page runs old
 * code against new files (a lazily loaded chunk of the old build is gone
 * from the new deployment), so it must reload, but a reload under the
 * Member's fingers would lose a half-typed Expense. So the reload waits for
 * the app to go to the background with no form open; meanwhile the home
 * screens show "New version ready" with a Reload button.
 *
 * A home-screen app can stay alive in the background for days without a
 * navigation, so it also checks for a new version each time it comes back
 * to the foreground and once an hour.
 */
import { useSyncExternalStore } from 'react'

/** The rule, kept pure for the tests. */
export function reloadsForUpdate(state: { updateReady: boolean; hidden: boolean; busy: boolean }): boolean {
  return state.updateReady && state.hidden && !state.busy
}

const CHECK_EVERY_MS = 60 * 60 * 1000

let updateReady = false
let busy = false
const listeners = new Set<() => void>()

function reloadIfIdle(): void {
  if (reloadsForUpdate({ updateReady, hidden: document.visibilityState === 'hidden', busy })) window.location.reload()
}

/** `registerSW`'s `onNeedReload`: the new version controls this page. */
export function updateActivated(): void {
  updateReady = true
  listeners.forEach((l) => l())
  reloadIfIdle()
}

/** Whether a form or another half-done task is on screen (set by App from its view). */
export function setBusy(value: boolean): void {
  busy = value
}

/** `registerSW`'s `onRegisteredSW`: look for a new deploy on every return to the foreground and hourly. */
export function checkForUpdates(registration: ServiceWorkerRegistration | undefined): void {
  if (!registration) return
  const check = () => {
    if (navigator.onLine !== false) registration.update().catch(() => {})
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  setInterval(check, CHECK_EVERY_MS)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', reloadIfIdle)
}

/** True once a new version is waiting for a reload; for the "New version ready" line. */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => updateReady,
    () => false,
  )
}
