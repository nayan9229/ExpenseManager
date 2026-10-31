import Dexie from 'dexie'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { ExpenseDb } from './db'

const deps = { indexedDB, IDBKeyRange }
let n = 0
const names = () => {
  n++
  return { name: `family-expenses-db-test-${n}`, legacy: `receipt-thumbnails-db-test-${n}` }
}

async function exists(name: string) {
  return (await indexedDB.databases()).some((d) => d.name === name)
}

/** The old ticket-08 thumbnail database, with one row in it. */
async function makeLegacyThumbnails(name: string) {
  const old = new Dexie(name, deps)
  old.version(1).stores({ thumbnails: 'fileId, savedAt' })
  await old.table('thumbnails').put({ fileId: 'f1', blob: new Blob(['x']), receiptType: 'image/jpeg', savedAt: 1 })
  old.close()
}

describe('ExpenseDb', () => {
  test('thumbnails are a table of the family-expenses database (schema version 2)', async () => {
    const { name, legacy } = names()
    const db = new ExpenseDb(name, deps, legacy)

    await db.thumbnails.put({ fileId: 'drive-1', blob: new Blob(['png']), receiptType: 'application/pdf', savedAt: 5 })

    expect(db.verno).toBe(2)
    expect((await db.thumbnails.get('drive-1'))?.receiptType).toBe('application/pdf')
    db.close()
  })

  test('upgrading a version 1 database keeps the Offline Queue and deletes the old receipt-thumbnails database', async () => {
    const { name, legacy } = names()
    const v1 = new Dexie(name, deps)
    v1.version(1).stores({ queue: '++seq, expenseId, state', cache: 'key', settings: 'key' })
    await v1.table('settings').put({ key: 'memberId', value: 'ramesh' })
    await v1.table('queue').add({ kind: 'delete', expenseId: 'e1', payload: { id: 'e1' }, queuedAt: 'x', attempts: 0, lastError: null, state: 'pending' })
    v1.close()
    await makeLegacyThumbnails(legacy)
    expect(await exists(legacy)).toBe(true)

    const db = new ExpenseDb(name, deps, legacy)
    await db.open()
    await db.legacyCleanup

    expect(await db.settings.get('memberId')).toEqual({ key: 'memberId', value: 'ramesh' })
    expect((await db.queue.toArray()).map((q) => q.expenseId)).toEqual(['e1'])
    expect(await db.thumbnails.count()).toBe(0)
    expect(await exists(legacy)).toBe(false)
    db.close()
  })

  test('a fresh install deletes a leftover receipt-thumbnails database too', async () => {
    const { name, legacy } = names()
    await makeLegacyThumbnails(legacy)

    const db = new ExpenseDb(name, deps, legacy)
    await db.open()
    await db.legacyCleanup

    expect(await exists(legacy)).toBe(false)
    db.close()
  })
})
