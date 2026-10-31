import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { afterEach, describe, expect, test } from 'vitest'
import { getThumbnail } from './receipts'
import { ThumbnailDb } from './thumbnailDb'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

type Answer =
  | { status: number; body: Uint8Array; type: string; receiptType?: string }
  | { status: number; json: unknown }
  | 'offline'

/**
 * A fake `receipt` function: answers each URL from the script and records
 * every request, so a test can prove the network was (or was not) used.
 */
function fakeReceiptApi(script: Record<string, Answer>) {
  const requests: string[] = []
  let offline = false
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests.push(url)
    const answer = script[url]
    if (offline || answer === 'offline') throw new TypeError('Failed to fetch')
    if (!answer) throw new Error(`unexpected GET ${url}`)
    if ('json' in answer) {
      return new Response(JSON.stringify(answer.json), { status: answer.status, headers: { 'Content-Type': 'application/json' } })
    }
    const headers: Record<string, string> = { 'Content-Type': answer.type }
    if (answer.receiptType) headers['X-Receipt-Type'] = answer.receiptType
    return new Response(answer.body.slice(), { status: answer.status, headers })
  }
  return {
    fetchImpl,
    requests,
    goOffline: () => {
      offline = true
    },
  }
}

let n = 0
const dbs: ThumbnailDb[] = []
function freshDb() {
  const db = new ThumbnailDb(`receipt-thumbnails-test-${++n}`, { indexedDB, IDBKeyRange })
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

async function bytesOf(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('getThumbnail', () => {
  test('fetches the thumbnail once, stores it by file ID, and serves it from Dexie when offline', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({
      '/api/receipt?id=drive-file-1&thumb=1': { status: 200, body: PNG, type: 'image/png', receiptType: 'image/jpeg' },
    })

    const first = await getThumbnail('drive-file-1', { db, fetchImpl: api.fetchImpl })
    api.goOffline()
    const again = await getThumbnail('drive-file-1', { db, fetchImpl: api.fetchImpl })

    expect(api.requests).toEqual(['/api/receipt?id=drive-file-1&thumb=1'])
    for (const thumb of [first, again]) {
      expect(thumb?.fileId).toBe('drive-file-1')
      expect(thumb?.receiptType).toBe('image/jpeg')
      expect(thumb?.blob.type).toBe('image/png')
      expect(await bytesOf(thumb!.blob)).toEqual(PNG)
    }
    const row = await db.thumbnails.get('drive-file-1')
    expect(await bytesOf(row!.blob)).toEqual(PNG)
  })
})
