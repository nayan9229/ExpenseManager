/**
 * Start-up for the offline side of the app (ticket 09), run once before
 * the first render: device settings out of Dexie, the kept read model into
 * the query cache (so the first screen works with no network), a one-time
 * request for persistent storage, and the Sync triggers.
 */
import { appDb } from './db'
import { loadDeviceSettings, requestPersistentStorage } from './device'
import { appQueue, queryClient, showKeptReadModel } from './readModel'

/** IndexedDB can hang on open in some Safari builds; never hold the first screen longer than this. */
const START_LIMIT_MS = 2_000

/**
 * Sync whenever the app may have come back: the `online` event, the page
 * becoming visible, `pageshow` (back/forward cache, iOS resume) and window
 * focus. iOS delivers some of these late or twice, so every one is just an
 * idempotent "maybe resumed"; a real request decides (research Q7).
 */
export function syncOnResume(sync: () => void, win: Window = window, doc: Document = document): () => void {
  const onVisible = () => {
    if (doc.visibilityState === 'visible') sync()
  }
  win.addEventListener('online', sync)
  win.addEventListener('pageshow', sync)
  win.addEventListener('focus', sync)
  doc.addEventListener('visibilitychange', onVisible)
  return () => {
    win.removeEventListener('online', sync)
    win.removeEventListener('pageshow', sync)
    win.removeEventListener('focus', sync)
    doc.removeEventListener('visibilitychange', onVisible)
  }
}

export async function startOffline(): Promise<void> {
  const ready = (async () => {
    await loadDeviceSettings(appDb())
    await showKeptReadModel(queryClient, appQueue())
  })()
  const opened = await Promise.race([
    ready.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), START_LIMIT_MS)),
  ])
  if (!opened) console.warn('The device database was slow to open; starting without it')
  void requestPersistentStorage()
  const sync = () => void appQueue().sync().catch(() => {})
  syncOnResume(sync)
  // App start.
  sync()
}
