import { Check, CloudOff, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { Expense } from '../lib/api'
import type { QueueItem, QueueState } from '../lib/db'
import { retryChoice } from '../lib/offlineQueue'
import { discardQueued, retryQueued } from '../lib/readModel'
import { formatRupees } from '../lib/rupees'
import { Button } from './Button'

/** The badge copy (user stories 41, 42, 46). */
export const SAVED_ON_PHONE = 'Saved on phone, will sync when online'
export const NEEDS_ATTENTION = 'Needs attention'

/** The small badge on an Expense row whose change is still on the phone. */
export function QueueBadge({ state }: { state: QueueState }) {
  if (state === 'needs-attention') {
    return (
      <span className="inline-flex items-center gap-2 rounded-xl border-2 border-terracotta px-3 py-0.5 text-terracotta">
        <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
        {NEEDS_ATTENTION}
      </span>
    )
  }
  return (
    <span className="flex w-full items-start gap-2 rounded-xl border-2 border-olive-sage px-3 py-0.5">
      <CloudOff aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      {SAVED_ON_PHONE}
    </span>
  )
}

/** What a queued item is about, in a few words. */
function describe(item: QueueItem, expenses: Expense[]): string {
  const known = item.kind === 'create' ? item.payload : expenses.find((e) => e.id === item.expenseId)
  const what = known ? `${formatRupees(known.amount)} for ${known.category}` : 'an Expense'
  if (item.kind === 'create') return `New expense: ${what}`
  if (item.kind === 'update') return `Change to ${what}`
  return `Delete of ${what}`
}

/**
 * The items the server refused for good, each with its message and Retry
 * and Discard, so the queue never sticks silently (user story 46). Also a
 * one-line count of changes still waiting for signal.
 */
export function OfflineQueuePanel({ items, expenses }: { items: QueueItem[]; expenses: Expense[] }) {
  const [busy, setBusy] = useState<number | null>(null)
  const refused = items.filter((i) => i.state === 'needs-attention')
  const pending = items.length - refused.length
  if (items.length === 0) return null

  async function act(seq: number, action: () => Promise<void>) {
    setBusy(seq)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Saved on this phone" className="flex flex-col gap-3">
      {pending > 0 && (
        <p role="status" className="flex items-center gap-3 rounded-2xl bg-sand p-4 text-lg">
          <CloudOff aria-hidden="true" className="size-7 shrink-0 text-olive-sage" />
          {pending === 1 ? '1 change' : `${pending} changes`} saved on phone, will sync when online.
        </p>
      )}
      {refused.map((item) => {
        const seq = item.seq ?? 0
        const choice = retryChoice(item)
        return (
          <div key={seq} role="alert" className="flex flex-col gap-3 rounded-2xl border-4 border-terracotta bg-warm-white p-4">
            <p className="flex items-start gap-3 text-xl font-bold">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-7 shrink-0 text-terracotta" />
              {NEEDS_ATTENTION}
            </p>
            <p className="text-lg font-semibold">{describe(item, expenses)}</p>
            <p className="break-words text-lg">{item.lastError?.message ?? 'The server refused this change.'}</p>
            <Button
              icon={choice.force ? Check : RefreshCw}
              disabled={busy !== null}
              onClick={() => void act(seq, () => retryQueued(seq, { force: choice.force }))}
              className="w-full"
            >
              {busy === seq ? 'Sending…' : choice.label}
            </Button>
            <Button icon={Trash2} variant="secondary" disabled={busy !== null} onClick={() => void act(seq, () => discardQueued(seq))} className="w-full">
              Discard
            </Button>
          </div>
        )
      })}
    </section>
  )
}
