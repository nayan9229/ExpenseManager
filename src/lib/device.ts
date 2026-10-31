/**
 * What this device remembers between loads: the last selected Member,
 * whether Bootstrap has run from here, and the voice entry language.
 *
 * Kept in the device database (Dexie, `settings` table) since ticket 09.
 * Reads stay synchronous: `loadDeviceSettings` fills an in-memory copy
 * once at start (moving any values the old localStorage build left behind,
 * once), and every write updates that copy and is saved in the background.
 *
 * Every function still takes an optional store so tests pass a fake, and
 * every call is wrapped: a browser that blocks storage behaves like a
 * fresh device.
 */
import type { ExpenseDb } from './db'

export type DeviceStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const SELECTED_MEMBER = 'fem.selectedMemberId'
const BOOTSTRAPPED = 'fem.bootstrapped'
const SPEECH_LANGUAGE = 'fem.speechLanguage'
const PERSIST_REQUESTED = 'fem.persistRequested'
/** Set once the localStorage values were moved, so they are never read again. */
const MOVED_FROM_LOCAL_STORAGE = 'fem.movedFromLocalStorage'
const LEGACY_KEYS = [SELECTED_MEMBER, BOOTSTRAPPED, SPEECH_LANGUAGE]

const memory = new Map<string, string>()
let database: ExpenseDb | null = null
let saving: Promise<void> = Promise.resolve()
/** Written while the database was still opening (a slow first start): saved, and kept, once it is open. */
const early = new Map<string, string | null>()

function save(key: string, value: string | null): void {
  const db = database
  if (!db) {
    early.set(key, value)
    return
  }
  saving = saving
    .then(async () => {
      if (value === null) await db.settings.delete(key)
      else await db.settings.put({ key, value })
    })
    .then(
      () => {},
      () => {
        // IndexedDB refused (quota, private mode): this load still remembers.
      },
    )
}

/** The device settings: an in-memory copy of the database's `settings` table. */
const deviceSettings: DeviceStore = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value)
    save(key, value)
  },
  removeItem: (key) => {
    memory.delete(key)
    save(key, null)
  },
}

function legacyStore(): DeviceStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Loads the device settings from `db` before the first screen renders. On
 * the first load after the update, the values the localStorage build kept
 * are copied in and removed from localStorage.
 */
export async function loadDeviceSettings(db: ExpenseDb, legacy: DeviceStore | null = legacyStore()): Promise<void> {
  memory.clear()
  early.clear()
  database = null
  try {
    const rows = await db.settings.toArray()
    if (!rows.some((r) => r.key === MOVED_FROM_LOCAL_STORAGE)) {
      for (const key of LEGACY_KEYS) {
        const value = read(legacy, key)
        if (value !== null && !rows.some((r) => r.key === key)) rows.push({ key, value })
      }
      rows.push({ key: MOVED_FROM_LOCAL_STORAGE, value: '1' })
      await db.settings.bulkPut(rows)
      for (const key of LEGACY_KEYS) write(legacy, key, null)
    }
    for (const { key, value } of rows) if (!early.has(key)) memory.set(key, value)
    database = db
    for (const [key, value] of early) save(key, value)
    early.clear()
  } catch {
    // No IndexedDB here: fall back to whatever localStorage still holds, for this load only.
    for (const key of LEGACY_KEYS) {
      const value = read(legacy, key)
      if (value !== null) memory.set(key, value)
    }
  }
}

/** Resolves once every setting written so far is in the database. */
export function deviceSettingsSaved(): Promise<void> {
  return saving
}

function defaultStore(): DeviceStore {
  return deviceSettings
}

function read(store: DeviceStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(store: DeviceStore | null, key: string, value: string | null): void {
  try {
    if (value === null) store?.removeItem(key)
    else store?.setItem(key, value)
  } catch {
    // Storage blocked: the device simply does not remember.
  }
}

/**
 * Asks the browser once, on the first run, to keep this site's storage
 * under pressure (the queue may hold Receipts not yet uploaded). Chrome
 * decides silently, Safari by heuristics such as being on the Home Screen.
 * Resolves with the browser's answer, or null when it was not asked.
 */
export async function requestPersistentStorage(
  storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined = globalThis.navigator?.storage,
  store: DeviceStore | null = defaultStore(),
): Promise<boolean | null> {
  if (!storage?.persist || read(store, PERSIST_REQUESTED) !== null) return null
  try {
    if (await storage.persisted()) return true
    const granted = await storage.persist()
    write(store, PERSIST_REQUESTED, granted ? 'granted' : 'denied')
    return granted
  } catch {
    return null
  }
}

/** The Member this device last selected, or null for a fresh device. */
export function rememberedMemberId(store: DeviceStore | null = defaultStore()): string | null {
  return read(store, SELECTED_MEMBER)
}

export function rememberMember(memberId: string, store: DeviceStore | null = defaultStore()): void {
  write(store, SELECTED_MEMBER, memberId)
}

export function forgetMember(store: DeviceStore | null = defaultStore()): void {
  write(store, SELECTED_MEMBER, null)
}

/** Whether Bootstrap has already run from this device. */
export function isBootstrapped(store: DeviceStore | null = defaultStore()): boolean {
  return read(store, BOOTSTRAPPED) === '1'
}

export function markBootstrapped(store: DeviceStore | null = defaultStore()): void {
  write(store, BOOTSTRAPPED, '1')
}

/** Forces Bootstrap to run again next load (e.g. after LEDGER_NOT_FOUND). */
export function forgetBootstrapped(store: DeviceStore | null = defaultStore()): void {
  write(store, BOOTSTRAPPED, null)
}

/** The languages voice entry recognises (spec: "Voice"). */
export type SpeechLanguage = 'en-IN' | 'hi-IN'

/** The voice entry language this device uses; English (India) until changed. */
export function speechLanguage(store: DeviceStore | null = defaultStore()): SpeechLanguage {
  return read(store, SPEECH_LANGUAGE) === 'hi-IN' ? 'hi-IN' : 'en-IN'
}

export function setSpeechLanguage(language: SpeechLanguage, store: DeviceStore | null = defaultStore()): void {
  write(store, SPEECH_LANGUAGE, language)
}
