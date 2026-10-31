import { describe, expect, test } from 'vitest'
import {
  forgetBootstrapped,
  forgetMember,
  isBootstrapped,
  markBootstrapped,
  rememberMember,
  rememberedMemberId,
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
