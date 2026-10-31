/**
 * What this device remembers between loads: the last selected Member and
 * whether Bootstrap has run from here. localStorage for now; ticket 09
 * moves device settings into Dexie alongside the Offline Queue.
 *
 * Every function takes the store so tests pass a fake, and every call is
 * wrapped: a browser that blocks storage behaves like a fresh device.
 */

export type DeviceStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const SELECTED_MEMBER = 'fem.selectedMemberId'
const BOOTSTRAPPED = 'fem.bootstrapped'

function defaultStore(): DeviceStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
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
