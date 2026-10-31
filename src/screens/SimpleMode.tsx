import { Camera, CircleCheck, Keyboard, Users } from 'lucide-react'
import { Button } from '../components/Button'
import type { Category, Expense, Member } from '../lib/api'
import { dayLabel, istToday } from '../lib/istDate'
import { lastFive } from '../lib/quickExpense'
import { formatRupees } from '../lib/rupees'

type Props = {
  member: Member
  members: Member[]
  categories: Category[]
  expenses: Expense[]
  /** The Expense just saved, for the confirmation line. */
  justSaved: Expense | null
  onQuickExpense: () => void
  onSwitch: () => void
}

/**
 * Simple Mode (GLOSSARY): greeting, the two giant cards, and the Member's
 * own last five Expenses. Scan Receipt is a placeholder until ticket 06;
 * ticket 10 adds the mic, ticket 05 makes each Expense tappable.
 */
export function SimpleMode({ member, members, categories, expenses, justSaved, onQuickExpense, onSwitch }: Props) {
  const today = istToday()
  const mine = lastFive(expenses, member.memberId)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Hello, {member.name}.</h1>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          disabled
          aria-describedby="scan-soon"
          className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-3xl bg-sand p-4 text-center text-xl font-bold opacity-60"
        >
          <Camera aria-hidden="true" className="size-12" strokeWidth={2} />
          Scan Receipt
          <span id="scan-soon" className="text-base font-normal">
            Coming soon
          </span>
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

      <p role="status" className="min-h-8 text-lg">
        {justSaved && (
          <span className="flex items-center gap-2">
            <CircleCheck aria-hidden="true" className="size-7 shrink-0 text-olive-sage" />
            Saved {formatRupees(justSaved.amount)} for {justSaved.category}.
          </span>
        )}
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Your last five</h2>
        {mine.length === 0 ? (
          <p className="rounded-2xl bg-sand p-4 text-lg">Nothing logged in the last 90 days. Tap Quick Expense to add one.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.map((e) => (
              <ExpenseRow key={e.id} expense={e} category={categories.find((c) => c.name === e.category)} members={members} member={member} today={today} />
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
}: {
  expense: Expense
  category: Category | undefined
  members: Member[]
  member: Member
  today: string
}) {
  const paidBy = expense.paidBy !== member.memberId ? (members.find((m) => m.memberId === expense.paidBy)?.name ?? 'Unknown') : null
  return (
    <li className="flex min-h-touch items-center gap-4 rounded-2xl bg-sand p-4">
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
        {(expense.reimbursementStatus === 'pending' || paidBy) && (
          <p className="mt-1 flex flex-wrap gap-2 text-base">
            {expense.reimbursementStatus === 'pending' && (
              <span className="rounded-full border-2 border-brass px-3">To be paid back</span>
            )}
            {paidBy && <span>Paid by {paidBy}</span>}
          </p>
        )}
      </div>
    </li>
  )
}
