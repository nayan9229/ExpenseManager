import { useState, type ReactNode } from 'react'
import { ExpenseForm } from '../components/ExpenseForm'
import { ApiError, type Expense, type Member, type ReadModel } from '../lib/api'
import { istToday } from '../lib/istDate'
import { newDraft, newExpenseId, toCreateInput, type ExpenseDraft } from '../lib/quickExpense'
import { saveExpense } from '../lib/readModel'

type Props = {
  member: Member
  model: ReadModel
  /** A partial draft to start from (ticket 10 voice, ticket 11 Recurring Rule prefill). */
  prefill?: Partial<ExpenseDraft>
  /** One line above the amount, e.g. what voice entry heard or why it failed. */
  notice?: ReactNode
  onSaved: (expense: Expense) => void
  onCancel: () => void
  /** The Session is gone (401): back to the Gatekeeper. */
  onUnpaired: () => void
}

/**
 * Quick Expense (user stories 15 to 24): the Expense form plus the create.
 * The ID is generated once when the screen opens, so tapping Save again
 * after a lost response replays the same create instead of adding a row.
 */
export function QuickExpense({ member, model, prefill, notice, onSaved, onCancel, onUnpaired }: Props) {
  const [today] = useState(() => istToday())
  const [id] = useState(() => newExpenseId())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(draft: ExpenseDraft) {
    setBusy(true)
    setError(null)
    try {
      const { expense } = await saveExpense(toCreateInput(draft, member.memberId, id))
      onSaved(expense)
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && err.status === 401) {
        onUnpaired()
        return
      }
      setError(
        err instanceof ApiError
          ? `Not saved: ${err.message}`
          : 'Not saved: could not reach the server. Check the connection and tap Save again.',
      )
    }
  }

  return (
    <ExpenseForm
      heading="Quick Expense"
      member={member}
      members={model.members}
      categories={model.categories}
      expenses={model.expenses}
      initial={{ ...newDraft(member, today), ...prefill }}
      today={today}
      busy={busy}
      error={error}
      onSubmit={(draft) => void submit(draft)}
      onCancel={onCancel}
    >
      {notice}
    </ExpenseForm>
  )
}
