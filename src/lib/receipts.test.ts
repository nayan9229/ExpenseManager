import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { afterEach, describe, expect, test } from 'vitest'
import { MAX_THUMBNAILS, getThumbnail, loadReceiptView } from './receipts'
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

  test('a Receipt Drive has not made a thumbnail for yet is null and is asked again next time', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({
      '/api/receipt?id=fresh&thumb=1': { status: 404, json: { code: 'NO_THUMBNAIL', message: 'not yet' } },
    })

    expect(await getThumbnail('fresh', { db, fetchImpl: api.fetchImpl })).toBeNull()
    expect(await getThumbnail('fresh', { db, fetchImpl: api.fetchImpl })).toBeNull()

    expect(api.requests).toHaveLength(2)
    expect(await db.thumbnails.count()).toBe(0)
  })

  test('offline with nothing cached rejects with the network error and stores nothing', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({ '/api/receipt?id=drive-file-2&thumb=1': 'offline' })

    await expect(getThumbnail('drive-file-2', { db, fetchImpl: api.fetchImpl })).rejects.toBeInstanceOf(TypeError)
    expect(await db.thumbnails.count()).toBe(0)
  })

  test('a lost Session rejects with the 401 so the app can go back to the Gatekeeper', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({ '/api/receipt?id=x&thumb=1': { status: 401, json: { code: 'NOT_PAIRED', message: 'pair again' } } })

    await expect(getThumbnail('x', { db, fetchImpl: api.fetchImpl })).rejects.toMatchObject({ status: 401, code: 'NOT_PAIRED' })
  })

  test('keeps at most MAX_THUMBNAILS, dropping the oldest first', async () => {
    const db = freshDb()
    const script: Record<string, Answer> = {}
    for (let i = 0; i <= MAX_THUMBNAILS; i++) {
      script[`/api/receipt?id=f${i}&thumb=1`] = { status: 200, body: PNG, type: 'image/png', receiptType: 'image/jpeg' }
    }
    const api = fakeReceiptApi(script)
    let clock = 1_000

    for (let i = 0; i <= MAX_THUMBNAILS; i++) {
      await getThumbnail(`f${i}`, { db, fetchImpl: api.fetchImpl, now: () => clock++ })
    }

    expect(await db.thumbnails.count()).toBe(MAX_THUMBNAILS)
    expect(await db.thumbnails.get('f0')).toBeUndefined()
    expect(await db.thumbnails.get(`f${MAX_THUMBNAILS}`)).toBeDefined()
  })
})

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9])
const DRIVE_VIEW = 'https://drive.google.com/file/d/drive-file-1/view?usp=drivesdk'

describe('loadReceiptView', () => {
  test('a photo comes back whole, as the image the lightbox shows', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({
      '/api/receipt?id=drive-file-1&thumb=1': { status: 200, body: PNG, type: 'image/png', receiptType: 'image/jpeg' },
      '/api/receipt?id=drive-file-1': { status: 200, body: JPEG, type: 'image/jpeg' },
    })

    const view = await loadReceiptView('drive-file-1', DRIVE_VIEW, { db, fetchImpl: api.fetchImpl })

    expect(view.kind).toBe('image')
    if (view.kind !== 'image') return
    expect(view.image.type).toBe('image/jpeg')
    expect(await bytesOf(view.image)).toEqual(JPEG)
  })

  test('a PDF shows its first-page thumbnail and the Drive link, without downloading the PDF', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({
      '/api/receipt?id=bill-1&thumb=1': { status: 200, body: PNG, type: 'image/png', receiptType: 'application/pdf' },
    })

    const view = await loadReceiptView('bill-1', DRIVE_VIEW, { db, fetchImpl: api.fetchImpl })

    expect(view.kind).toBe('pdf')
    if (view.kind !== 'pdf') return
    expect(await bytesOf(view.thumb!)).toEqual(PNG)
    expect(view.driveUrl).toBe(DRIVE_VIEW)
    expect(api.requests).toEqual(['/api/receipt?id=bill-1&thumb=1'])
  })

  test('a PDF with no thumbnail yet is still recognised by what the proxy sends', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({
      '/api/receipt?id=bill-2&thumb=1': { status: 404, json: { code: 'NO_THUMBNAIL', message: 'not yet' } },
      '/api/receipt?id=bill-2': { status: 200, body: new TextEncoder().encode('%PDF-1.7'), type: 'application/pdf' },
    })

    const view = await loadReceiptView('bill-2', DRIVE_VIEW, { db, fetchImpl: api.fetchImpl })

    expect(view).toEqual({ kind: 'pdf', thumb: null, driveUrl: DRIVE_VIEW })
  })

  test('a Receipt over the 4 MB cap shows the thumbnail and the Drive link the proxy sent', async () => {
    const db = freshDb()
    const fromProxy = 'https://drive.google.com/file/d/big-1/view?usp=drivesdk'
    const api = fakeReceiptApi({
      '/api/receipt?id=big-1&thumb=1': { status: 200, body: PNG, type: 'image/png', receiptType: 'image/jpeg' },
      '/api/receipt?id=big-1': { status: 413, json: { code: 'RECEIPT_TOO_LARGE', message: 'too large', webViewLink: fromProxy, size: 6_200_000 } },
    })

    const view = await loadReceiptView('big-1', '', { db, fetchImpl: api.fetchImpl })

    expect(view.kind).toBe('tooLarge')
    if (view.kind !== 'tooLarge') return
    expect(view.driveUrl).toBe(fromProxy)
    expect(await bytesOf(view.thumb!)).toEqual(PNG)
  })

  test('offline, a cached thumbnail is shown in place of the photo', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({
      '/api/receipt?id=drive-file-1&thumb=1': { status: 200, body: PNG, type: 'image/png', receiptType: 'image/jpeg' },
    })
    await getThumbnail('drive-file-1', { db, fetchImpl: api.fetchImpl })
    api.goOffline()

    const view = await loadReceiptView('drive-file-1', DRIVE_VIEW, { db, fetchImpl: api.fetchImpl })

    expect(view.kind).toBe('offline')
    if (view.kind !== 'offline') return
    expect(await bytesOf(view.thumb)).toEqual(PNG)
  })

  test('offline with nothing cached rejects with the network error', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({})
    api.goOffline()

    await expect(loadReceiptView('drive-file-9', DRIVE_VIEW, { db, fetchImpl: api.fetchImpl })).rejects.toBeInstanceOf(TypeError)
  })

  test('a Receipt the proxy does not know rejects with its 404', async () => {
    const db = freshDb()
    const api = fakeReceiptApi({
      '/api/receipt?id=gone&thumb=1': { status: 404, json: { code: 'RECEIPT_NOT_FOUND', message: 'No Receipt has that ID' } },
      '/api/receipt?id=gone': { status: 404, json: { code: 'RECEIPT_NOT_FOUND', message: 'No Receipt has that ID' } },
    })

    await expect(loadReceiptView('gone', DRIVE_VIEW, { db, fetchImpl: api.fetchImpl })).rejects.toMatchObject({ status: 404, code: 'RECEIPT_NOT_FOUND' })
  })
})
