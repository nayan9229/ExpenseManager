import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { ExpenseDb } from './db'
import {
  deviceSettingsSaved,
  dismissInstallHint,
  installHintDismissed,
  loadDeviceSettings,
  forgetBootstrapped,
  forgetMember,
  isBootstrapped,
  markBootstrapped,
  rememberMember,
  rememberedMemberId,
  requestPersistentStorage,
  setSpeechLanguage,
  speechLanguage,
  type DeviceStore,
} from './device'

/** A Storage-shaped fake backed by a Map. */
function memoryStore(): DeviceStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

/** A store whose every call throws, like Safari private mode or a blocked origin. */
const brokenStore: DeviceStore = {
  getItem: () => {
    throw new Error('storage disabled')
  },
  setItem: () => {
    throw new Error('storage disabled')
  },
  removeItem: () => {
    throw new Error('storage disabled')
  },
}

describe('remembered Member', () => {
  test('a fresh device remembers nobody', () => {
    expect(rememberedMemberId(memoryStore())).toBeNull()
  })

  test('remembers the last selected Member until forgotten', () => {
    const store = memoryStore()

    rememberMember('ramesh', store)
    expect(rememberedMemberId(store)).toBe('ramesh')

    rememberMember('admin', store)
    expect(rememberedMemberId(store)).toBe('admin')

    forgetMember(store)
    expect(rememberedMemberId(store)).toBeNull()
  })

  test('a broken store behaves like a fresh device and never throws', () => {
    expect(() => rememberMember('ramesh', brokenStore)).not.toThrow()
    expect(rememberedMemberId(brokenStore)).toBeNull()
    expect(() => forgetMember(brokenStore)).not.toThrow()
  })

  test('no store at all behaves like a fresh device', () => {
    expect(rememberedMemberId(null)).toBeNull()
    expect(() => rememberMember('ramesh', null)).not.toThrow()
  })
})

describe('bootstrapped flag', () => {
  test('is false on a fresh device and true once marked', () => {
    const store = memoryStore()
    expect(isBootstrapped(store)).toBe(false)

    markBootstrapped(store)
    expect(isBootstrapped(store)).toBe(true)

    forgetBootstrapped(store)
    expect(isBootstrapped(store)).toBe(false)
  })

  test('a broken store reports not bootstrapped and never throws', () => {
    expect(isBootstrapped(brokenStore)).toBe(false)
    expect(() => markBootstrapped(brokenStore)).not.toThrow()
  })
})

describe('speech language', () => {
  test('is English (India) on a fresh device and remembers Hindi (India) once chosen', () => {
    const store = memoryStore()
    expect(speechLanguage(store)).toBe('en-IN')

    setSpeechLanguage('hi-IN', store)
    expect(speechLanguage(store)).toBe('hi-IN')

    setSpeechLanguage('en-IN', store)
    expect(speechLanguage(store)).toBe('en-IN')
  })

  test('anything else stored reads as English (India)', () => {
    const store = memoryStore()
    store.setItem('fem.speechLanguage', 'fr-FR')
    expect(speechLanguage(store)).toBe('en-IN')
  })

  test('a broken store reads English (India) and never throws', () => {
    expect(speechLanguage(brokenStore)).toBe('en-IN')
    expect(() => setSpeechLanguage('hi-IN', brokenStore)).not.toThrow()
  })
})

describe('install hint dismissed', () => {
  test('is not dismissed on a fresh device and stays dismissed once dismissed', () => {
    const store = memoryStore()
    expect(installHintDismissed(store)).toBe(false)

    dismissInstallHint(store)
    expect(installHintDismissed(store)).toBe(true)
    expect(installHintDismissed(store)).toBe(true)
  })

  test('a broken store reads not dismissed and never throws', () => {
    expect(installHintDismissed(brokenStore)).toBe(false)
    expect(() => dismissInstallHint(brokenStore)).not.toThrow()
  })
})

describe('device settings kept in the device database', () => {
  let n = 0
  const dbNamed = (name: string) => new ExpenseDb(name, { indexedDB, IDBKeyRange })

  test('what the old localStorage held is read once, moved into the database, and survives a reload', async () => {
    const name = `device-${++n}`
    const legacy = memoryStore()
    legacy.setItem('fem.selectedMemberId', 'ramesh')
    legacy.setItem('fem.bootstrapped', '1')
    legacy.setItem('fem.speechLanguage', 'hi-IN')
    legacy.setItem('unrelated', 'kept')

    await loadDeviceSettings(dbNamed(name), legacy)

    expect(rememberedMemberId()).toBe('ramesh')
    expect(isBootstrapped()).toBe(true)
    expect(speechLanguage()).toBe('hi-IN')
    expect([...legacy.map.keys()]).toEqual(['unrelated'])

    rememberMember('admin')
    setSpeechLanguage('en-IN')
    await deviceSettingsSaved()

    // A reload, with a stale value somehow back in localStorage: not read again.
    const stale = memoryStore()
    stale.setItem('fem.selectedMemberId', 'someone-else')
    await loadDeviceSettings(dbNamed(name), stale)

    expect(rememberedMemberId()).toBe('admin')
    expect(speechLanguage()).toBe('en-IN')
    expect(isBootstrapped()).toBe(true)
  })

  test('a fresh device with nothing anywhere starts empty', async () => {
    await loadDeviceSettings(dbNamed(`device-${++n}`), memoryStore())

    expect(rememberedMemberId()).toBeNull()
    expect(isBootstrapped()).toBe(false)
    expect(speechLanguage()).toBe('en-IN')
  })
})

describe('persistent storage', () => {
  function fakeStorage(granted: boolean) {
    const calls: string[] = []
    return {
      calls,
      persisted: async () => (calls.push('persisted'), false),
      persist: async () => (calls.push('persist'), granted),
    }
  }

  test('is asked for on the first run only, whatever the answer', async () => {
    const store = memoryStore()
    const storage = fakeStorage(false)

    expect(await requestPersistentStorage(storage, store)).toBe(false)
    expect(await requestPersistentStorage(storage, store)).toBeNull()

    expect(storage.calls).toEqual(['persisted', 'persist'])
  })

  test('a browser without the API is left alone', async () => {
    expect(await requestPersistentStorage(undefined, memoryStore())).toBeNull()
  })
})
