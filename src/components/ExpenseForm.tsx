import { ArrowLeft, Check, CircleAlert, Delete, TriangleAlert, Wallet } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import type { Category, Expense, Member, PaymentMethod, ReimbursementStatus } from '../lib/api'
import { addDays, dayLabel } from '../lib/istDate'
import { pressKey, type Digit, type KeypadKey } from '../lib/keypad'
import { draftProblem, findDuplicate, visibleCategories, type ExpenseDraft } from '../lib/quickExpense'
import { formatRupees } from '../lib/rupees'
import { Button } from './Button'

const PAYMENT_METHODS: PaymentMethod[] = ['UPI', 'Cash', 'Card', 'Bank Transfer']
const DIGITS: Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const ADDS = [50, 100, 500] as const
const REIMBURSEMENTS: { value: ReimbursementStatus; label: string }[] = [
  { value: 'none', label: 'Not owed' },
  { value: 'pending', label: 'To be paid back' },
  { value: 'done', label: 'Paid back' },
]

export type ExpenseFormProps = {
  /** Screen title, e.g. "Quick Expense" or "Edit Expense". */
  heading: string
  /** The Member logging it: their Role filters the Category grid. */
  member: Member
  members: Member[]
  categories: Category[]
  /** The loaded window, for the soft duplicate warning. */
  expenses: Expense[]
  /** Starting values: `newDraft(...)`, an existing Expense, OCR or voice output. */
  initial: ExpenseDraft
  /** Today in IST (`istToday()`), passed in so the screen and the rules agree. */
  today: string
  /** The Expense being edited, so it is not its own duplicate. */
  excludeId?: string
  submitLabel?: string
  /** True while the save is in flight: controls stay visible, Save is disabled. */
  busy?: boolean
  /** Why the last save failed, shown above Save. */
  error?: string | null
  onSubmit: (draft: ExpenseDraft) => void
  onCancel: () => void
  /** Rendered between the title and the amount (ticket 06 puts the Receipt here). */
  children?: ReactNode
  /**
   * Editing an existing Expense: a Paid By Member picker and a three-way
   * Reimbursement control replace the "I paid from my own pocket" toggle.
   */
  editing?: boolean
  /** Rendered below Save (the edit screen's Delete and its confirm step). */
  footer?: ReactNode
  /** Save's label while busy (the edit screen is busy deleting too). */
  busyLabel?: string
}

/** `yesterday`, `today`, or `on Thu 29 Oct`, for a sentence. */
function onDay(date: string, today: string): string {
  const label = dayLabel(date, today)
  return /^(Today|Yesterday|Tomorrow)$/.test(label) ? label.toLowerCase() : `on ${label}`
}

/**
 * The Expense form (spec "Simple Mode", Quick Expense): oversized keypad,
 * Category grid filtered by Role, Payment Method chips, Today / Yesterday /
 * date picker, note, "I paid from my own pocket", Save. Every control is at
 * least 56px. It owns the draft and hands it to `onSubmit`; saving is the
 * caller's job, so the same form serves create, edit, Receipt and voice.
 */
export function ExpenseForm({
  heading,
  member,
  members,
  categories,
  expenses,
  initial,
  today,
  excludeId,
  submitLabel = 'Save',
  busy = false,
  error = null,
  onSubmit,
  onCancel,
  children,
  editing = false,
  footer,
  busyLabel = 'Saving…',
}: ExpenseFormProps) {
  const [draft, setDraft] = useState<ExpenseDraft>(initial)
  const [attempted, setAttempted] = useState(false)
  const [duplicateAccepted, setDuplicateAccepted] = useState(false)
  const ids = { note: useId(), date: useId(), amount: useId() }

  function change(patch: Partial<ExpenseDraft>) {
    setDraft((d) => ({ ...d, ...patch }))
    setDuplicateAccepted(false)
  }
  const press = (key: KeypadKey) => change({ amount: pressKey(draft.amount, key) })

  const grid = visibleCategories(categories, member.role, draft.category)
  const problem = draftProblem(draft, today)
  const duplicate =
    draft.category && draft.amount > 0
      ? findDuplicate(expenses, { amount: draft.amount, category: draft.category, expenseDate: draft.expenseDate }, excludeId)
      : null
  const showDuplicate = attempted && duplicate !== null && !duplicateAccepted
  const yesterday = addDays(today, -1)
  const ownPocket = draft.reimbursementStatus !== 'none'

  function save() {
    setAttempted(true)
    if (problem || busy) return
    if (duplicate && !duplicateAccepted) return
    onSubmit(draft)
  }

  function saveAnyway() {
    setDuplicateAccepted(true)
    if (!problem && !busy) onSubmit(draft)
  }

  const key =
    'flex h-16 min-w-touch items-center justify-center rounded-2xl bg-sand text-3xl font-semibold select-none ' +
    'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.96] transition-transform'
  const chip = (selected: boolean) =>
    'inline-flex min-h-touch min-w-touch items-center justify-center gap-2 rounded-full px-5 text-lg font-semibold ' +
    'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform ' +
    (selected ? 'bg-mocha text-warm-white' : 'bg-sand text-mocha')
  const sectionTitle = 'text-lg font-semibold'

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-8">
      <header className="flex items-center gap-3">
        <Button icon={ArrowLeft} variant="secondary" onClick={onCancel} disabled={busy}>
          Back
        </Button>
        <h1 className="text-2xl font-bold leading-tight">{heading}</h1>
      </header>

      {children}

      <section aria-labelledby={ids.amount} className="flex flex-col gap-4">
        <h2 id={ids.amount} className="sr-only">
          Amount
        </h2>
        <output aria-live="polite" className="rounded-3xl bg-sand px-5 py-4 text-center text-5xl font-bold tabular-nums">
          {formatRupees(draft.amount)}
        </output>
        <div role="group" aria-label="Add to the amount" className="grid grid-cols-3 gap-3">
          {ADDS.map((n) => (
            <button key={n} type="button" aria-label={`Add ${n} rupees`} onClick={() => press({ add: n })} className={key + ' text-2xl'}>
              +{n}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Amount keypad" className="grid grid-cols-3 gap-3">
          {DIGITS.map((d) => (
            <button key={d} type="button" onClick={() => press(d)} className={key}>
              {d}
            </button>
          ))}
          <button type="button" onClick={() => press('clear')} className={key + ' text-xl'}>
            Clear
          </button>
          <button type="button" onClick={() => press(0)} className={key}>
            0
          </button>
          <button type="button" onClick={() => press('backspace')} aria-label="Erase last digit" className={key}>
            <Delete aria-hidden="true" className="size-8" />
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Category</h2>
        {grid.length === 0 ? (
          <p className="rounded-2xl bg-sand p-4 text-lg">No Categories for you yet. Ask the Admin to add one.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {grid.map((c) => {
              const selected = draft.category === c.name
              return (
                <button
                  key={c.name}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => change({ category: c.name })}
                  className={
                    'flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl p-3 text-center text-lg font-semibold leading-tight ' +
                    'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform ' +
                    (selected ? 'bg-mocha text-warm-white' : 'bg-sand text-mocha')
                  }
                >
                  <span aria-hidden="true" className="text-4xl">
                    {c.emoji}
                  </span>
                  {c.name}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Paid with</h2>
        <div className="flex flex-wrap gap-3">
          {PAYMENT_METHODS.map((pm) => (
            <button
              key={pm}
              type="button"
              aria-pressed={draft.paymentMethod === pm}
              onClick={() => change({ paymentMethod: pm })}
              className={chip(draft.paymentMethod === pm)}
            >
              {pm}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>When</h2>
        <div className="flex flex-wrap gap-3">
          <button type="button" aria-pressed={draft.expenseDate === today} onClick={() => change({ expenseDate: today })} className={chip(draft.expenseDate === today)}>
            Today
          </button>
          <button
            type="button"
            aria-pressed={draft.expenseDate === yesterday}
            onClick={() => change({ expenseDate: yesterday })}
            className={chip(draft.expenseDate === yesterday)}
          >
            Yesterday
          </button>
        </div>
        <label htmlFor={ids.date} className="text-lg">
          Another day
        </label>
        <input
          id={ids.date}
          type="date"
          value={draft.expenseDate}
          max={addDays(today, 1)}
          onChange={(e) => change({ expenseDate: e.target.value })}
          className="min-h-touch w-full rounded-2xl border-2 border-mocha bg-warm-white px-4 text-xl outline-none focus-visible:ring-4 focus-visible:ring-olive-sage"
        />
        {draft.expenseDate && draft.expenseDate !== today && draft.expenseDate !== yesterday && (
          <p className="text-lg">{dayLabel(draft.expenseDate, today)}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <label htmlFor={ids.note} className={sectionTitle}>
          Note <span className="font-normal">(optional)</span>
        </label>
        <input
          id={ids.note}
          type="text"
          value={draft.note}
          maxLength={500}
          enterKeyHint="done"
          placeholder="medicines for Papa"
          onChange={(e) => change({ note: e.target.value })}
          className="min-h-touch w-full rounded-2xl border-2 border-mocha bg-warm-white px-4 text-xl outline-none focus-visible:ring-4 focus-visible:ring-olive-sage"
        />
      </section>

      {editing ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Paid by</h2>
            <div className="flex flex-wrap gap-3">
              {members.map((m) => (
                <button
                  key={m.memberId}
                  type="button"
                  aria-pressed={draft.paidBy === m.memberId}
                  onClick={() => change({ paidBy: m.memberId })}
                  className={chip(draft.paidBy === m.memberId)}
                >
                  {m.name}
                </button>
              ))}
              {!members.some((m) => m.memberId === draft.paidBy) && (
                <button type="button" aria-pressed="true" className={chip(true)}>
                  Unknown
                </button>
              )}
            </div>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Pay back</h2>
            <div className="flex flex-wrap gap-3">
              {REIMBURSEMENTS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={draft.reimbursementStatus === r.value}
                  onClick={() => change({ reimbursementStatus: r.value })}
                  className={chip(draft.reimbursementStatus === r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>
        </>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={ownPocket}
          onClick={() => change({ reimbursementStatus: ownPocket ? 'none' : 'pending' })}
          className={
            'flex min-h-touch w-full items-center gap-4 rounded-2xl p-4 text-left text-lg font-semibold ' +
            'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage ' +
            (ownPocket ? 'bg-mocha text-warm-white' : 'bg-sand text-mocha')
          }
        >
          <Wallet aria-hidden="true" className="size-8 shrink-0" />
          <span className="flex flex-col">
            I paid from my own pocket
            <span className="text-base font-normal">
              {draft.reimbursementStatus === 'done'
                ? 'Already paid back'
                : ownPocket
                  ? 'The Admin will pay you back'
                  : 'Tap if the Household owes you this'}
            </span>
          </span>
        </button>
      )}

      {!editing && draft.paidBy !== member.memberId && (
        <p className="text-lg">Paid by {members.find((m) => m.memberId === draft.paidBy)?.name ?? 'Unknown'}</p>
      )}

      <section className="flex flex-col gap-4 pb-6">
        {showDuplicate && duplicate && (
          <div role="alert" className="flex flex-col gap-4 rounded-2xl border-4 border-terracotta bg-sand p-4">
            <p className="flex items-start gap-3 text-lg">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-7 shrink-0 text-terracotta" />
              <span>
                {formatRupees(duplicate.amount)} for {duplicate.category} {onDay(duplicate.expenseDate, today)} is already
                logged
                {duplicate.loggedBy !== member.memberId &&
                  ` by ${members.find((m) => m.memberId === duplicate.loggedBy)?.name ?? 'Unknown'}`}
                . Is this a second one?
              </span>
            </p>
            <Button icon={Check} onClick={saveAnyway} disabled={busy} className="w-full">
              Save anyway
            </Button>
          </div>
        )}
        <p role="alert" className="min-h-8 text-lg text-terracotta">
          {attempted && problem ? (
            <span className="flex items-center gap-2">
              <CircleAlert aria-hidden="true" className="size-6 shrink-0" />
              {problem}
            </span>
          ) : (
            error
          )}
        </p>
        <Button icon={Check} onClick={save} disabled={busy} className="w-full">
          {busy ? busyLabel : submitLabel}
        </Button>
        {footer}
      </section>
    </main>
  )
}
