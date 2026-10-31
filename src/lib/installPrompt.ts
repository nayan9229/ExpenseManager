/**
 * Browser glue for Pairing and installing (the pure parts are in
 * `pairing.ts` and tested there). Imported by the Gatekeeper, so these
 * listeners are registered while the module graph loads, before React
 * renders: Chrome fires `beforeinstallprompt` early, often while the boot
 * check is still waiting for `pair`.
 */
import { useSyncExternalStore } from 'react'
import { installPlatform, pairTokenFromUrl, type InstallPlatform } from './pairing'

/** Chrome's install prompt event (not in the DOM typings). */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep Chrome's mini-infobar away; the Gatekeeper shows its own button.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

/**
 * Whether Android's install prompt is on offer, and a function that shows
 * it. A prompt can be shown once; after either answer the button goes away.
 */
export function useInstallPrompt(): { available: boolean; install: () => Promise<'accepted' | 'dismissed'> } {
  const available = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => deferred !== null,
    () => false,
  )
  return {
    available,
    async install() {
      const event = deferred
      if (!event) return 'dismissed'
      deferred = null
      notify()
      await event.prompt()
      return (await event.userChoice).outcome
    },
  }
}

/** This browser's install guidance (see `installPlatform`). */
export function currentInstallPlatform(): InstallPlatform {
  const nav = navigator as Navigator & { standalone?: boolean }
  const standalone = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
  return installPlatform({ userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints ?? 0, standalone })
}

/**
 * The `pairToken` the Admin's QR link put in the address. Taking it strips
 * it with `history.replaceState`, so it is not left in the address bar,
 * the history or a bookmark, and a second call (React StrictMode's double
 * effect) finds nothing and pairs nothing.
 */
export function takePairToken(): string | null {
  const { pathname, search, hash, href } = window.location
  const { token, cleanUrl } = pairTokenFromUrl(href)
  if (cleanUrl !== pathname + search + hash) window.history.replaceState(window.history.state, '', cleanUrl)
  return token
}
