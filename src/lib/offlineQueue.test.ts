import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { ApiError, duplicateReceiptOf, type CreateExpenseInput, type Expense, type ReadModel } from './api'
import { ExpenseDb } from './db'
import { OfflineQueue, retryChoice } from './offlineQueue'
import type { PutFile } from './upload'

let dbCount = 0
/** A fresh in-memory IndexedDB database per test. */
const freshDb = () => new ExpenseDb(`test-${++dbCount}`, { indexedDB, IDBKeyRange })

const NOW = new Date('2026-10-31T03:45:00Z') // 09:15 IST

const stored = (id: string, over: Partial<Expense> = {}): Expense => ({
  id,
  createdAt: '2026-10-30T20:00:00+05:30',
  updatedAt: '2026-10-30T20:00:00+05:30',
  expenseDate: '2026-10-30',
  loggedBy: 'ramesh',
  paidBy: 'ramesh',
  amount: 100,
  currency: 'INR',
  category: 'Groceries',
  merchantNote: '',
  paymentMethod: 'UPI',
  driveFileId: '',
  driveViewUrl: '',
  fileHash: '',
  reimbursementStatus: 'none',
  status: 'active',
  ...over,
})

const input = (id: string, over: Partial<CreateExpenseInput> = {}): CreateExpenseInput => ({
  id,
  expenseDate: '2026-10-31',
  loggedBy: 'ramesh',
  paidBy: 'ramesh',
  amount: 450,
  category: 'Medical & Pharmacy',
  merchantNote: 'medicines',
  paymentMethod: 'UPI',
  reimbursementStatus: 'none',
  ...over,
})

const server0: ReadModel = {
  expenses: [stored('old-1')],
  members: [],
  categories: [],
  recurringRules: [],
  ledgerUrl: '',
  serverTime: '2026-10-31T09:00:00+05:30',
}

type Scripted = 'ok' | 'network' | 'lost' | { status: number; code: string; message: string; body?: object }

/**
 * A fake Household server holding Expense rows by ID, answering the way
 * the Go `expenses` and `upload-url` functions do. `script` answers the
 * next requests instead: 'network' never reaches the server, 'lost'
 * reaches it (the row is written) but the answer never comes back.
 */
function fakeServer() {
  const rows = new Map<string, Expense>()
  const calls: string[] = []
  const bodies: unknown[] = []
  const script: Scripted[] = []
  /** Rows appended to the Ledger, replays excluded. */
  const appended: string[] = []
  let offline = false

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (offline) throw new TypeError('Failed to fetch')
    const next = script.shift()
    if (next === 'network') throw new TypeError('Failed to fetch')
    calls.push(`${method} ${url}`)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    bodies.push(body)
    if (next && next !== 'lost' && next !== 'ok') return Response.json({ code: next.code, message: next.message, ...next.body }, { status: next.status })

    let res: Response
    if (url === '/api/upload-url') {
      res = Response.json({ uploadUrl: `https://drive.example/session/${body.name}`, folderId: 'm', folderPath: 'Receipts/2026/10-October', name: body.name })
    } else if (method === 'POST') {
      const existing = rows.get(body.id)
      if (existing) res = Response.json(existing, { status: 200 })
      else {
        const row = stored(body.id, { ...body, createdAt: '2026-10-31T10:00:00+05:30', updatedAt: '2026-10-31T10:00:00+05:30', driveViewUrl: body.driveFileId ? `https://drive.example/view/${body.driveFileId}` : '' })
        delete (row as Partial<{ force: boolean }>).force
        rows.set(body.id, row)
        appended.push(body.id)
        res = Response.json(row, { status: 201 })
      }
    } else if (method === 'PUT') {
      const row = rows.get(body.id)
      if (!row || row.status === 'deleted') res = Response.json({ code: 'EXPENSE_NOT_FOUND', message: 'No such Expense' }, { status: 404 })
      else {
        const updated = { ...row, ...body, updatedAt: '2026-10-31T10:05:00+05:30' }
        rows.set(body.id, updated)
        res = Response.json(updated)
      }
    } else if (method === 'DELETE') {
      const id = new URL(url, 'http://x').searchParams.get('id') ?? ''
      const row = rows.get(id)
      if (!row) res = Response.json({ code: 'EXPENSE_NOT_FOUND', message: 'No such Expense' }, { status: 404 })
      else {
        const deleted = { ...row, status: 'deleted' as const }
        rows.set(id, deleted)
        res = Response.json(deleted)
      }
    } else throw new Error(`unexpected ${method} ${url}`)

    if (next === 'lost') throw new TypeError('The network connection was lost')
    return res
  }

  return {
    rows,
    appended,
    calls,
    bodies,
    fetchImpl,
    script: (...answers: Scripted[]) => void script.push(...answers),
    goOffline: () => void (offline = true),
    goOnline: () => void (offline = false),
  }
}

/** A queue on a fresh database that already holds `server0`, plus the fake server and recorded retry timers. */
async function setup() {
  const db = freshDb()
  const server = fakeServer()
  for (const e of server0.expenses) server.rows.set(e.id, e)
  const retries: number[] = []
  const puts: string[] = []
  const put: PutFile = async (url, blob) => {
    puts.push(`${url} ${blob.type} ${blob.size}`)
    return { status: 200, body: JSON.stringify({ id: `drive-${puts.length}` }) }
  }
  const make = () =>
    new OfflineQueue({
      db,
      fetchImpl: server.fetchImpl,
      put,
      now: () => NOW,
      sleep: async () => {},
      retryLater: (ms: number) => void retries.push(ms),
      isOffline: () => false,
    })
  const queue = make()
  await queue.remember(server0)
  const listed = async () => (await queue.readModel())?.expenses.map((e) => e.id)
  return { db, server, queue, make, retries, puts, listed }
}

describe('saving with no signal', () => {
  test('Save succeeds at once and the Expense waits in the queue', async () => {
    const { server, queue } = await setup()
    server.goOffline()

    const saved = await queue.save({ kind: 'create', payload: input('new-1') })

    expect(saved.queued).toBe(true)
    expect(saved.expense).toMatchObject({ id: 'new-1', amount: 450, status: 'active', currency: 'INR' })
    const items = await queue.items()
    expect(items.map((i) => [i.kind, i.expenseId, i.state])).toEqual([['create', 'new-1', 'pending']])
    expect(server.rows.has('new-1')).toBe(false)
  })
})

describe('the list shown while offline', () => {
  test('a queued Expense is listed first, marked as waiting, even after the app is reopened', async () => {
    const { server, queue, make } = await setup()
    server.goOffline()

    await queue.save({ kind: 'create', payload: input('new-1') })
    const reopened = make()

    const model = await reopened.readModel()
    expect(model?.expenses.map((e) => e.id)).toEqual(['new-1', 'old-1'])
    expect(await reopened.waiting()).toEqual(new Map([['new-1', 'pending']]))
  })

  test('before the first successful load there is nothing to show', async () => {
    const queue = new OfflineQueue({ db: freshDb() })

    expect(await queue.readModel()).toBeNull()
  })
})

describe('Sync', () => {
  test('when signal returns the queued Expense reaches the server and the list shows the stored copy', async () => {
    const { server, queue, listed } = await setup()
    server.goOffline()
    await queue.save({ kind: 'create', payload: input('new-1') })
    server.goOnline()

    const report = await queue.sync()

    expect(report).toMatchObject({ synced: 1, remaining: 0 })
    expect(server.rows.get('new-1')).toMatchObject({ amount: 450, createdAt: '2026-10-31T10:00:00+05:30' })
    expect(await queue.items()).toEqual([])
    expect(await listed()).toEqual(['new-1', 'old-1'])
    expect((await queue.readModel())?.expenses[0]?.createdAt).toBe('2026-10-31T10:00:00+05:30')
  })
})

describe('edits and deletes made offline', () => {
  test('show at once and replay in the order they were made', async () => {
    const { server, queue } = await setup()
    server.goOffline()

    await queue.save({ kind: 'create', payload: input('new-1') })
    const edited = await queue.save({ kind: 'update', payload: { id: 'new-1', amount: 500, merchantNote: 'medicines for Papa' } })
    await queue.save({ kind: 'delete', id: 'old-1' })

    expect(edited).toMatchObject({ queued: true, expense: { id: 'new-1', amount: 500, merchantNote: 'medicines for Papa' } })
    expect((await queue.readModel())?.expenses.map((e) => [e.id, e.amount])).toEqual([['new-1', 500]])

    server.goOnline()
    await queue.sync()

    expect(server.calls).toEqual(['POST /api/expenses', 'PUT /api/expenses', 'DELETE /api/expenses?id=old-1'])
    expect(server.rows.get('new-1')).toMatchObject({ amount: 500, merchantNote: 'medicines for Papa' })
    expect(server.rows.get('old-1')?.status).toBe('deleted')
    expect(await queue.items()).toEqual([])
    expect((await queue.readModel())?.expenses.map((e) => [e.id, e.amount])).toEqual([['new-1', 500]])
  })
})

describe('transient failures', () => {
  test('a 5xx, a 429 or no answer keeps the item and retries later with a growing wait, for as long as it takes', async () => {
    const { server, queue, retries } = await setup()
    server.script({ status: 502, code: 'GOOGLE_ERROR', message: 'Sheets is down' })

    const saved = await queue.save({ kind: 'create', payload: input('new-1') })

    expect(saved.queued).toBe(true)
    expect((await queue.items())[0]).toMatchObject({ state: 'pending', attempts: 1, lastError: { status: 502, message: 'Sheets is down' } })

    server.script({ status: 429, code: 'RATE_LIMITED', message: 'slow down' }, 'network', 'network', 'network', 'network', 'network', 'network', 'network', 'network')
    for (let i = 0; i < 9; i++) await queue.sync()

    const [item] = await queue.items()
    expect(item).toMatchObject({ state: 'pending', attempts: 10, lastError: { status: 0 } })
    expect(retries).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000])

    await queue.sync()
    expect(await queue.items()).toEqual([])
    expect(server.rows.has('new-1')).toBe(true)
  })
})

describe('permanent failures', () => {
  test('a refusal marks the item "needs attention" with the server message and holds back only that Expense', async () => {
    const { server, queue, retries } = await setup()
    server.goOffline()
    await queue.save({ kind: 'create', payload: input('new-1') })
    await queue.save({ kind: 'update', payload: { id: 'new-1', amount: 500 } })
    await queue.save({ kind: 'create', payload: input('new-2', { amount: 80 }) })
    server.goOnline()
    retries.length = 0
    server.script({ status: 422, code: 'UNKNOWN_CATEGORY', message: 'There is no Category called Medical & Pharmacy' })

    await queue.sync()

    expect(server.calls).toEqual(['POST /api/expenses', 'POST /api/expenses'])
    expect(server.rows.has('new-2')).toBe(true)
    expect((await queue.items()).map((i) => [i.kind, i.expenseId, i.state, i.lastError?.message])).toEqual([
      ['create', 'new-1', 'needs-attention', 'There is no Category called Medical & Pharmacy'],
      ['update', 'new-1', 'pending', undefined],
    ])
    expect(await queue.waiting()).toEqual(new Map([['new-1', 'needs-attention']]))
    expect(retries).toEqual([])

    // Nothing more goes out for it until the Member decides.
    await queue.sync()
    expect(server.calls).toHaveLength(2)
  })
})

describe('Retry and Discard', () => {
  async function refusedOffline() {
    const s = await setup()
    s.server.goOffline()
    await s.queue.save({ kind: 'create', payload: input('new-1') })
    await s.queue.save({ kind: 'update', payload: { id: 'new-1', amount: 500 } })
    await s.queue.save({ kind: 'update', payload: { id: 'old-1', amount: 999 } })
    await s.queue.save({ kind: 'delete', id: 'old-1' })
    s.server.goOnline()
    const refusal = { status: 422, code: 'INVALID_AMOUNT', message: 'Amount must be more than zero' }
    s.server.script(refusal, refusal)
    await s.queue.sync()
    return s
  }

  test('discarding a refused create takes the Expense and its later edits off the phone', async () => {
    const { queue, listed } = await refusedOffline()
    const [create] = await queue.items()
    expect(create).toMatchObject({ kind: 'create', state: 'needs-attention' })
    expect(await listed()).toEqual(['new-1'])

    await queue.discard(create!.seq!)

    expect((await queue.items()).map((i) => [i.kind, i.expenseId])).toEqual([
      ['update', 'old-1'],
      ['delete', 'old-1'],
    ])
    expect(await listed()).toEqual([])
  })

  test('discarding a refused edit puts the server values back on the list', async () => {
    const { queue } = await refusedOffline()
    const edit = (await queue.items()).find((i) => i.expenseId === 'old-1' && i.kind === 'update')
    expect(edit?.state).toBe('needs-attention')
    const del = (await queue.items()).find((i) => i.kind === 'delete')
    await queue.discard(del!.seq!)
    expect((await queue.readModel())?.expenses.find((e) => e.id === 'old-1')?.amount).toBe(999)

    await queue.discard(edit!.seq!)

    expect((await queue.readModel())?.expenses.find((e) => e.id === 'old-1')?.amount).toBe(100)
  })

  test('Retry sends a refused item again, then the changes held behind it', async () => {
    const { queue, server } = await refusedOffline()
    const [create] = await queue.items()
    server.calls.length = 0

    await queue.retry(create!.seq!)

    expect(server.calls).toEqual(['POST /api/expenses', 'PUT /api/expenses'])
    expect(server.rows.get('new-1')?.amount).toBe(500)
    expect((await queue.items()).map((i) => i.expenseId)).toEqual(['old-1', 'old-1'])
  })
})

describe('exactly once', () => {
  test('a create whose answer was lost is replayed by its ID and the Ledger holds one row', async () => {
    const { server, queue, listed } = await setup()
    server.script('lost')

    const saved = await queue.save({ kind: 'create', payload: input('new-1') })
    expect(saved.queued).toBe(true)
    expect(server.appended).toEqual(['new-1'])

    const report = await queue.sync()

    expect(report.synced).toBe(1)
    expect(server.calls).toEqual(['POST /api/expenses', 'POST /api/expenses'])
    expect(server.appended).toEqual(['new-1'])
    expect(await listed()).toEqual(['new-1', 'old-1'])
    expect(await queue.items()).toEqual([])
  })

  test('two Sync triggers at once send each item once', async () => {
    const { server, queue } = await setup()
    server.goOffline()
    await queue.save({ kind: 'create', payload: input('new-1') })
    await queue.save({ kind: 'create', payload: input('new-2') })
    server.goOnline()

    await Promise.all([queue.sync(), queue.sync(), queue.sync()])

    expect(server.calls).toEqual(['POST /api/expenses', 'POST /api/expenses'])
  })
})

describe('a Receipt scanned offline', () => {
  const receipt = () => ({ blob: new Blob(['jpeg bytes'], { type: 'image/jpeg' }), mimeType: 'image/jpeg', ext: 'jpg', fileHash: 'ab12' })

  test('is kept on the phone, then uploaded and linked on Sync with no OCR', async () => {
    const { server, queue, puts } = await setup()
    server.goOffline()
    await queue.save({ kind: 'create', payload: input('new-1'), receipt: receipt() })
    expect((await queue.items())[0]).toMatchObject({ receipt: { mimeType: 'image/jpeg', fileHash: 'ab12' } })
    server.goOnline()

    await queue.sync()

    expect(server.calls).toEqual(['POST /api/upload-url', 'POST /api/expenses'])
    expect(server.bodies[0]).toEqual({ name: 'new-1.jpg', mimeType: 'image/jpeg', size: 10, expenseDate: '2026-10-31' })
    expect(puts).toEqual(['https://drive.example/session/new-1.jpg image/jpeg 10'])
    expect(server.bodies[1]).toMatchObject({ id: 'new-1', driveFileId: 'drive-1', fileHash: 'ab12', merchantNote: 'medicines' })
    expect(server.rows.get('new-1')).toMatchObject({ driveFileId: 'drive-1', driveViewUrl: 'https://drive.example/view/drive-1' })
    expect(await queue.items()).toEqual([])
  })

  test('a create that fails after the upload does not upload the Receipt again', async () => {
    const { server, queue, puts } = await setup()
    server.goOffline()
    await queue.save({ kind: 'create', payload: input('new-1'), receipt: receipt() })
    server.goOnline()
    server.script('ok', { status: 503, code: 'HTTP_ERROR', message: 'busy' })

    await queue.sync()
    await queue.sync()

    expect(puts).toHaveLength(1)
    expect(server.calls).toEqual(['POST /api/upload-url', 'POST /api/expenses', 'POST /api/expenses'])
    expect(server.bodies[2]).toMatchObject({ driveFileId: 'drive-1', fileHash: 'ab12' })
    expect(await queue.items()).toEqual([])
  })
})

describe('saving with signal', () => {
  test('Save waits for the server and shows the stored copy', async () => {
    const { queue, listed } = await setup()

    const saved = await queue.save({ kind: 'create', payload: input('new-1') })

    expect(saved).toMatchObject({ queued: false, expense: { id: 'new-1', createdAt: '2026-10-31T10:00:00+05:30' } })
    expect(await queue.items()).toEqual([])
    expect(await listed()).toEqual(['new-1', 'old-1'])
  })

  test('a refusal comes back to the open screen instead of waiting in the queue', async () => {
    const { server, queue, listed } = await setup()
    const earlier = stored('old-1', { fileHash: 'ab12' })
    server.script({ status: 409, code: 'DUPLICATE_RECEIPT', message: 'This receipt was already added', body: { expense: earlier } })

    const err = await queue.save({ kind: 'create', payload: input('new-1', { fileHash: 'ab12', driveFileId: 'f1' }) }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(duplicateReceiptOf(err)).toEqual(earlier)
    expect(await queue.items()).toEqual([])
    expect(await listed()).toEqual(['old-1'])
  })

  test('an edit of an Expense deleted on another phone is dropped and the Expense leaves the list', async () => {
    const { server, queue, listed } = await setup()
    server.rows.delete('old-1')

    const err = await queue.save({ kind: 'update', payload: { id: 'old-1', amount: 5 } }).catch((e: unknown) => e)

    expect(err).toMatchObject({ code: 'EXPENSE_NOT_FOUND' })
    expect(await queue.items()).toEqual([])
    expect(await listed()).toEqual([])
  })

  test('deleting an Expense already gone from the Ledger counts as deleted', async () => {
    const { server, queue, listed } = await setup()
    server.rows.delete('old-1')

    const saved = await queue.save({ kind: 'delete', id: 'old-1' })

    expect(saved.queued).toBe(false)
    expect(await queue.items()).toEqual([])
    expect(await listed()).toEqual([])
  })

  test('a server that does not answer in time does not hold Save: the Expense is saved on the phone', async () => {
    const db = freshDb()
    const hanging: typeof fetch = () => new Promise(() => {})
    const queue = new OfflineQueue({ db, fetchImpl: hanging, saveWaitMs: 5, retryLater: () => {} })
    await queue.remember(server0)

    const saved = await queue.save({ kind: 'create', payload: input('new-1') })

    expect(saved.queued).toBe(true)
    expect((await queue.readModel())?.expenses.map((e) => e.id)).toEqual(['new-1', 'old-1'])
  })

  test('a phone that knows it is offline does not wait at all', async () => {
    const db = freshDb()
    const hanging: typeof fetch = () => new Promise(() => {})
    const queue = new OfflineQueue({ db, fetchImpl: hanging, saveWaitMs: 60_000, isOffline: () => true, retryLater: () => {} })

    const saved = await queue.save({ kind: 'create', payload: input('new-1') })

    expect(saved.queued).toBe(true)
  })
})

describe('a lost Session', () => {
  test('a 401 keeps the item waiting (it is not the item’s fault) and stops Sync', async () => {
    const { server, queue } = await setup()
    server.goOffline()
    await queue.save({ kind: 'create', payload: input('new-1') })
    await queue.save({ kind: 'create', payload: input('new-2') })
    server.goOnline()
    server.script({ status: 401, code: 'NOT_PAIRED', message: 'Pair this phone again' })

    const report = await queue.sync()

    expect(report).toMatchObject({ unpaired: true, synced: 0 })
    expect(server.calls).toHaveLength(1)
    expect((await queue.items()).map((i) => i.state)).toEqual(['pending', 'pending'])
  })
})

describe('a slow server', () => {
  test('Save gives up waiting after 1.5 seconds by default: the Expense is saved on the phone', async () => {
    const db = freshDb()
    const hanging: typeof fetch = () => new Promise(() => {})
    const queue = new OfflineQueue({ db, fetchImpl: hanging, isOffline: () => false, retryLater: () => {} })
    await queue.remember(server0)

    const started = Date.now()
    const saved = await queue.save({ kind: 'create', payload: input('new-1') })
    const waited = Date.now() - started

    expect(saved.queued).toBe(true)
    expect(waited).toBeGreaterThanOrEqual(1_400)
    expect(waited).toBeLessThan(2_500)
  })

  test('a duplicate Receipt refused after Save gave up becomes Needs attention, and Add anyway saves it', async () => {
    const db = freshDb()
    const server = fakeServer()
    const earlier = stored('old-1', { fileHash: 'ab12' })
    server.rows.set('old-1', earlier)
    let release!: () => void
    const late = new Promise<void>((resolve) => (release = resolve))
    let first = true
    const slow: typeof fetch = async (input, init) => {
      if (first) {
        first = false
        await late
        return Response.json({ code: 'DUPLICATE_RECEIPT', message: 'This receipt was already added', expense: earlier }, { status: 409 })
      }
      return server.fetchImpl(input, init)
    }
    const queue = new OfflineQueue({ db, fetchImpl: slow, saveWaitMs: 5, isOffline: () => false, retryLater: () => {} })
    await queue.remember(server0)

    const saved = await queue.save({ kind: 'create', payload: input('new-1', { fileHash: 'ab12', driveFileId: 'f1' }) })
    expect(saved.queued).toBe(true)
    release()
    await queue.sync()

    const [item] = await queue.items()
    expect(item).toMatchObject({ state: 'needs-attention', lastError: { status: 409, code: 'DUPLICATE_RECEIPT', message: 'This receipt was already added' } })
    expect(retryChoice(item!)).toEqual({ label: 'Add anyway', force: true })

    await queue.retry(item!.seq!, retryChoice(item!))

    expect(server.bodies.at(-1)).toMatchObject({ id: 'new-1', force: true })
    expect(await queue.items()).toEqual([])
    expect((await queue.readModel())?.expenses.map((e) => e.id)).toContain('new-1')
  })

  test('any other refusal is retried as it is', () => {
    const base = { seq: 1, expenseId: 'e', queuedAt: '', attempts: 1, state: 'needs-attention' as const }
    const refused = { ...base, kind: 'delete' as const, payload: { id: 'e' }, lastError: { status: 422, code: 'INVALID_NOTE', message: 'Too long' } }
    expect(retryChoice(refused)).toEqual({ label: 'Retry', force: false })
  })
})
