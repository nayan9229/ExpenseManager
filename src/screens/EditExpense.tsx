import { ArrowLeft, Trash2, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { ExpenseForm } from '../components/ExpenseForm'
import { ApiError, type Expense, type Member, type ReadModel } from '../lib/api'
import { canEdit, draftFromExpense, toUpdateInput } from '../lib/editExpense'
import { istToday } from '../lib/istDate'
import type { ExpenseDraft } from '../lib/quickExpense'
import { removeExpense, saveEdit } from '../lib/readModel'

type Props = {
  /** The Member acting: their Role filters the Category grid and decides who may edit. */
  member: Member
  model: ReadModel
  /** The Expense as it was when the screen opened. */
  expense: Expense
  onSaved: (expense: Expense) => void
  onDeleted: (expense: Expense) => void
  onCancel: () => void
  /** The Session is gone (401): back to the Gatekeeper. */
  onUnpaired: () => void
}

/** Words for a failed save or delete, shown above Save. */
function failure(err: unknown, verb: 'saved' | 'deleted'): string {
  if (err instanceof ApiError && err.code === 'EXPENSE_NOT_FOUND') return 'This Expense was deleted on another phone. Tap Back.'
  if (err instanceof ApiError) return `Not ${verb}: ${err.message}`
  return `Not ${verb}: could not reach the server. Check the connection and try again.`
}

/**
 * Edit Expense (user stories 53 to 56): the Quick Expense form prefilled
 * from the Expense, with Paid By and Reimbursement, plus Delete behind an
 * explicit Yes / No. An Admin may edit any Expense, everyone else only the
 * ones they logged (ADR-0002: the device enforces it, not the server).
 */
export function EditExpense({ member, model, expense, onSaved, onDeleted, onCancel, onUnpaired }: Props) {
  const [today] = useState(() => istToday())
  const [pending, setPending] = useState<'saved' | 'deleted' | null>(null)
  const busy = pending !== null
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run<T>(action: () => Promise<T>, verb: 'saved' | 'deleted', done: (value: T) => void) {
    setPending(verb)
    setError(null)
    try {
      done(await action())
    } catch (err) {
      setPending(null)
      setConfirming(false)
      if (err instanceof ApiError && err.status === 401) {
        onUnpaired()
        return
      }
      setError(failure(err, verb))
    }
  }

  if (!canEdit(member, expense)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-8">
        <h1 className="text-2xl font-bold leading-tight">Edit Expense</h1>
        <p className="rounded-2xl bg-sand p-4 text-lg">Only the Member who logged this Expense, or the Admin, can change it.</p>
        <Button icon={ArrowLeft} variant="secondary" onClick={onCancel} className="w-full">
          Back
        </Button>
      </main>
    )
  }

  const footer = confirming ? (
    <div role="alertdialog" aria-labelledby="confirm-delete" className="flex flex-col gap-4 rounded-2xl border-4 border-terracotta bg-warm-white p-4">
      <p id="confirm-delete" className="flex items-center gap-3 text-xl font-bold">
        <TriangleAlert aria-hidden="true" className="size-7 shrink-0 text-terracotta" />
        Delete this expense?
      </p>
      <div className="flex flex-col gap-3">
        <Button
          icon={Trash2}
          variant="danger"
          disabled={busy}
          className="w-full"
          onClick={() => void run(() => removeExpense(expense.id), 'deleted', () => onDeleted(expense))}
        >
          {busy ? 'Deleting…' : 'Yes, delete'}
        </Button>
        <Button icon={X} variant="secondary" disabled={busy} onClick={() => setConfirming(false)} className="w-full">
          No, keep it
        </Button>
      </div>
    </div>
  ) : (
    <Button icon={Trash2} variant="danger" disabled={busy} onClick={() => setConfirming(true)} className="w-full">
      Delete
    </Button>
  )

  return (
    <ExpenseForm
      heading="Edit Expense"
      member={member}
      members={model.members}
      categories={model.categories}
      expenses={model.expenses}
      initial={draftFromExpense(expense)}
      today={today}
      excludeId={expense.id}
      editing
      busy={busy}
      busyLabel={pending === 'deleted' ? 'Save' : 'Saving…'}
      error={error}
      onSubmit={(draft: ExpenseDraft) => void run(() => saveEdit(toUpdateInput(draft, expense.id), { base: expense }), 'saved', onSaved)}
      onCancel={onCancel}
      footer={footer}
      receiptNumberField
    />
  )
}
