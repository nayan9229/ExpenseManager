import { Camera, CircleCheck, Keyboard, Pencil, Trash2, Users } from 'lucide-react'
import { Button } from '../components/Button'
import { NEEDS_ATTENTION, OfflineQueuePanel, QueueBadge, SAVED_ON_PHONE } from '../components/OfflineQueuePanel'
import { VoiceEntry, type VoiceResult } from '../components/VoiceEntry'
import type { Category, Expense, Member } from '../lib/api'
import { canEdit } from '../lib/editExpense'
import { dayLabel, istToday } from '../lib/istDate'
import type { QueueState } from '../lib/db'
import { waitingStates } from '../lib/offlineQueue'
import { lastFive } from '../lib/quickExpense'
import { useOfflineQueue } from '../lib/readModel'
import { formatRupees } from '../lib/rupees'

type Props = {
  member: Member
  members: Member[]
  categories: Category[]
  expenses: Expense[]
  /** The Expense just saved, for the confirmation line. */
  justSaved: Expense | null
  /** The Expense just deleted, for the confirmation line. */
  justDeleted?: Expense | null
  onScanReceipt: () => void
  onQuickExpense: () => void
  /** A voice attempt finished: open Quick Expense with its prefill or its one-line failure. */
  onVoice: (result: VoiceResult) => void
  /** Opens an Expense for edit or delete. */
  onEdit: (expense: Expense) => void
  onSwitch: () => void
}

/**
 * Simple Mode (GLOSSARY): greeting, the two giant cards, and the Member's
 * own last five Expenses, each one tappable to edit or delete it. The mic
 * shows only where the browser can listen.
 */
export function SimpleMode({
  member,
  members,
  categories,
  expenses,
  justSaved,
  justDeleted = null,
  onScanReceipt,
  onQuickExpense,
  onVoice,
  onEdit,
  onSwitch,
}: Props) {
  const today = istToday()
  const mine = lastFive(expenses, member.memberId)
  const queue = useOfflineQueue()
  const waiting = waitingStates(queue)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Hello, {member.name}.</h1>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={onScanReceipt}
          className={
            'flex min-h-40 flex-col items-center justify-center gap-3 rounded-3xl bg-mocha p-4 text-center text-xl font-bold text-warm-white ' +
            'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'
          }
        >
          <Camera aria-hidden="true" className="size-12" strokeWidth={2} />
          Scan Receipt
        </button>
        <button
          type="button"
          onClick={onQuickExpense}
          className={
            'flex min-h-40 flex-col items-center justify-center gap-3 rounded-3xl bg-mocha p-4 text-center text-xl font-bold text-warm-white ' +
            'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'
          }
        >
          <Keyboard aria-hidden="true" className="size-12" strokeWidth={2} />
          Quick Expense
        </button>
      </div>

      <VoiceEntry member={member} categories={categories} onResult={onVoice} />

      <p role="status" className="min-h-8 text-lg">
        {justSaved && (
          <span className="flex items-center gap-2">
            <CircleCheck aria-hidden="true" className="size-7 shrink-0 text-olive-sage" />
            Saved {formatRupees(justSaved.amount)} for {justSaved.category}
            {waiting.get(justSaved.id) === 'pending' ? `. ${SAVED_ON_PHONE}.` : '.'}
          </span>
        )}
        {!justSaved && justDeleted && (
          <span className="flex items-center gap-2">
            <Trash2 aria-hidden="true" className="size-7 shrink-0 text-terracotta" />
            Deleted {formatRupees(justDeleted.amount)} for {justDeleted.category}.
          </span>
        )}
      </p>

      <OfflineQueuePanel items={queue} expenses={expenses} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Your last five</h2>
        {mine.length > 0 && <p className="text-lg">Tap one to fix or delete it.</p>}
        {mine.length === 0 ? (
          <p className="rounded-2xl bg-sand p-4 text-lg">Nothing logged in the last 90 days. Tap Quick Expense to add one.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                category={categories.find((c) => c.name === e.category)}
                members={members}
                member={member}
                today={today}
                waiting={waiting.get(e.id)}
                onEdit={canEdit(member, e) ? () => onEdit(e) : undefined}
              />
            ))}
          </ul>
        )}
      </section>

      <Button icon={Users} variant="secondary" onClick={onSwitch} className="mt-auto w-full">
        Switch Member
      </Button>
    </main>
  )
}

function ExpenseRow({
  expense,
  category,
  members,
  member,
  today,
  waiting,
  onEdit,
}: {
  expense: Expense
  category: Category | undefined
  members: Member[]
  member: Member
  today: string
  /** Set while a change to this Expense is still on the phone. */
  waiting?: QueueState | undefined
  /** Absent when this Member may not change it. */
  onEdit?: () => void
}) {
  const paidBy = expense.paidBy !== member.memberId ? (members.find((m) => m.memberId === expense.paidBy)?.name ?? 'Unknown') : null
  const body = (
    <>
      <span
        role="img"
        aria-label={expense.category}
        className="flex size-14 shrink-0 items-center justify-center rounded-full bg-warm-white text-3xl"
      >
        {category?.emoji ?? '📦'}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-xl font-bold tabular-nums">{formatRupees(expense.amount)}</span>
          <span className="shrink-0 text-base">{dayLabel(expense.expenseDate, today)}</span>
        </p>
        <p className="truncate text-base">{expense.merchantNote || expense.category}</p>
        {(expense.reimbursementStatus === 'pending' || paidBy || waiting) && (
          <p className="mt-1 flex flex-wrap gap-2 text-base">
            {waiting && <QueueBadge state={waiting} />}
            {expense.reimbursementStatus === 'pending' && (
              <span className="rounded-full border-2 border-brass px-3">To be paid back</span>
            )}
            {paidBy && <span>Paid by {paidBy}</span>}
          </p>
        )}
      </div>
      {onEdit && <Pencil aria-hidden="true" className="size-7 shrink-0" />}
    </>
  )
  const row = 'flex min-h-touch w-full items-center gap-4 rounded-2xl bg-sand p-4 text-left'
  return (
    <li>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${formatRupees(expense.amount)} for ${expense.category}, ${dayLabel(expense.expenseDate, today)}${waiting ? `, ${waiting === 'pending' ? SAVED_ON_PHONE : NEEDS_ATTENTION}` : ''}`}
          className={row + ' outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'}
        >
          {body}
        </button>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  )
}
