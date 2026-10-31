import {
  Camera,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  HandCoins,
  Keyboard,
  Pencil,
  QrCode,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Users,
  Wrench,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { OfflineQueuePanel } from '../components/OfflineQueuePanel'
import { UpdateBanner } from '../components/UpdateBanner'
import { ApiError, runBootstrap, type Category, type Expense, type Member, type ReadModel } from '../lib/api'
import { receiptNumberLine } from '../lib/receipts'
import { markPaidBack, useMonthModel, usePendingReimbursements } from '../lib/adminData'
import {
  breakdown,
  burnRates,
  categoryKey,
  dueNotLogged,
  mergeExpenses,
  paidByMember,
  prefillFromRule,
  reimbursableQueue,
  repairSummary,
  repairWarnings,
  type Bar,
} from '../lib/adminMode'
import { dayLabel, istToday } from '../lib/istDate'
import { monthLabel, monthOf, shiftMonth, type Month } from '../lib/month'
import type { ExpenseDraft } from '../lib/quickExpense'
import { queryClient, readModelKey, useOfflineQueue } from '../lib/readModel'
import { formatRupees } from '../lib/rupees'

type Props = {
  /** The Admin, PIN already typed. */
  member: Member
  /** The default window (90 days): the Reimbursable Queue falls back to it until every pending Reimbursement has loaded. */
  model: ReadModel
  /** The month on screen and the Member filter; App keeps them so a trip to edit comes back to the same view. */
  month: Month
  onMonth: (month: Month) => void
  filter: string | null
  onFilter: (memberId: string | null) => void
  justSaved: Expense | null
  justDeleted: Expense | null
  /** Opens Quick Expense, prefilled when it comes from a due Recurring Rule. */
  onQuickExpense: (prefill?: Partial<ExpenseDraft>) => void
  /** Opens the existing edit screen: the Admin may edit any Expense. */
  onEdit: (expense: Expense) => void
  /** Opens Scan Receipt (ticket 06). Absent: the button shows "Coming soon". */
  onScanReceipt?: () => void
  /** The pairing modal (QR and Pair Code). Absent until ticket 12 wires it. */
  onPairDevice?: () => void
  onSwitch: () => void
  onUnpaired: () => void
}

/**
 * Admin Mode (user stories 57 to 65): the month at a glance. Every panel
 * is computed on the device from the selected month's Expenses, narrowed
 * by the Member filter (Paid By). The "Due this month" card always looks at
 * the whole Household, since a Rule is logged by whoever pays it.
 */
export function AdminMode(props: Props) {
  const { member, model, month, onMonth, filter, onFilter } = props
  const today = istToday()
  const thisMonth = monthOf(today)
  const monthModel = useMonthModel(month)
  const pendingModel = usePendingReimbursements()
  const offlineItems = useOfflineQueue()
  const data = monthModel.data
  const members = data?.members ?? model.members
  const categories = data?.categories ?? model.categories
  const loadingMonth = monthModel.isFetching && monthModel.isPlaceholderData

  const unpaired = [monthModel.error, pendingModel.error].some((err) => err instanceof ApiError && err.status === 401)
  const { onUnpaired } = props
  useEffect(() => {
    if (unpaired) onUnpaired()
  }, [unpaired, onUnpaired])

  const monthExpenses = data ? data.expenses.filter((e) => monthOf(e.expenseDate) === month) : []
  const shown = paidByMember(monthExpenses, filter)
  const burn = burnRates(categories, shown)
  // Every pending Reimbursement, however old; until that list arrives, the
  // ones in the windows already loaded.
  const owed = pendingModel.data?.expenses ?? mergeExpenses(model.expenses, data?.expenses ?? [])
  const queue = reimbursableQueue(paidByMember(owed, filter), members)
  const due = dueNotLogged(data?.recurringRules ?? model.recurringRules, monthExpenses, month)
  const filterName = filter === null ? null : (members.find((m) => m.memberId === filter)?.name ?? 'Unknown')

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <UpdateBanner />
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Admin Mode</p>
        <h1 className="text-3xl font-bold leading-tight">Hello, {member.name}.</h1>
      </header>

      {/* A change refused after Save already let the Admin go (a late 409) waits here. */}
      <OfflineQueuePanel items={offlineItems} expenses={model.expenses} />

      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          disabled={!props.onScanReceipt}
          onClick={props.onScanReceipt}
          aria-describedby={props.onScanReceipt ? undefined : 'admin-scan-soon'}
          className={
            'flex min-h-32 flex-col items-center justify-center gap-2 rounded-3xl bg-sand p-4 text-center text-xl font-bold ' +
            'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform disabled:opacity-60'
          }
        >
          <Camera aria-hidden="true" className="size-10" strokeWidth={2} />
          Scan Receipt
          {!props.onScanReceipt && (
            <span id="admin-scan-soon" className="text-base font-normal">
              Coming soon
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => props.onQuickExpense()}
          className={
            'flex min-h-32 flex-col items-center justify-center gap-2 rounded-3xl bg-mocha p-4 text-center text-xl font-bold text-warm-white ' +
            'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'
          }
        >
          <Keyboard aria-hidden="true" className="size-10" strokeWidth={2} />
          Quick Expense
        </button>
      </div>

      <SavedLine justSaved={props.justSaved} justDeleted={props.justDeleted} />

      <MonthSelector month={month} thisMonth={thisMonth} onMonth={onMonth} />

      <MemberFilter members={members} filter={filter} onFilter={onFilter} />

      {monthModel.isPending ? (
        <p aria-live="polite" className="flex items-center gap-3 text-lg">
          <CircleDashed aria-hidden="true" className="size-7 shrink-0 animate-spin text-brass" />
          Loading {monthLabel(month)}…
        </p>
      ) : monthModel.isError && !data ? (
        <section role="alert" className="flex flex-col gap-4 rounded-3xl bg-sand p-5">
          <p className="flex items-start gap-3 text-lg">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-7 shrink-0 text-terracotta" />
            Could not load {monthLabel(month)}: {monthModel.error.message}
          </p>
          <Button icon={RefreshCw} onClick={() => void monthModel.refetch()} className="w-full">
            Try again
          </Button>
        </section>
      ) : (
        <div aria-busy={loadingMonth} className={'flex flex-col gap-8 ' + (loadingMonth ? 'opacity-60' : '')}>
          <BurnRatePanel burn={burn} who={filterName} />
          <BreakdownPanel burn={burn} who={filterName} />
          <DuePanel
            due={due}
            month={month}
            hasRules={(data?.recurringRules ?? model.recurringRules).length > 0}
            onLog={(prefill) => props.onQuickExpense(prefill)}
            categories={categories}
            today={today}
          />
          <QueuePanel queue={queue} members={members} categories={categories} today={today} onUnpaired={props.onUnpaired} />
          <MonthExpenses
            expenses={shown}
            month={month}
            who={filterName}
            members={members}
            categories={categories}
            today={today}
            onEdit={props.onEdit}
          />
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Household tools</h2>
        <Button
          icon={ExternalLink}
          variant="secondary"
          disabled={model.ledgerUrl === ''}
          onClick={() => window.open(model.ledgerUrl, '_blank', 'noopener,noreferrer')}
          className="w-full"
        >
          Open the Ledger
        </Button>
        <RepairButton onUnpaired={props.onUnpaired} />
        <Button
          icon={QrCode}
          variant="secondary"
          disabled={!props.onPairDevice}
          onClick={props.onPairDevice}
          aria-describedby={props.onPairDevice ? undefined : 'pair-soon'}
          className="w-full"
        >
          Pair a device
        </Button>
        {!props.onPairDevice && (
          <p id="pair-soon" className="text-base">
            Pairing by QR code is coming soon. Until then, type the Access Code on the new device.
          </p>
        )}
      </section>

      <Button icon={Users} variant="secondary" onClick={props.onSwitch} className="mt-auto w-full">
        Switch Member
      </Button>
    </main>
  )
}

function SavedLine({ justSaved, justDeleted }: { justSaved: Expense | null; justDeleted: Expense | null }) {
  return (
    <p role="status" className="min-h-8 text-lg empty:hidden">
      {justSaved && (
        <span className="flex items-center gap-2">
          <CircleCheck aria-hidden="true" className="size-7 shrink-0 text-olive-sage" />
          Saved {formatRupees(justSaved.amount)} for {justSaved.category}.
        </span>
      )}
      {!justSaved && justDeleted && (
        <span className="flex items-center gap-2">
          <Trash2 aria-hidden="true" className="size-7 shrink-0 text-terracotta" />
          Deleted {formatRupees(justDeleted.amount)} for {justDeleted.category}.
        </span>
      )}
    </p>
  )
}

const stepButton =
  'inline-flex min-h-touch min-w-touch items-center justify-center gap-1 rounded-2xl bg-sand px-3 text-lg font-semibold ' +
  'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform disabled:opacity-40'

function MonthSelector({ month, thisMonth, onMonth }: { month: Month; thisMonth: Month; onMonth: (m: Month) => void }) {
  const prev = shiftMonth(month, -1)
  const next = shiftMonth(month, 1)
  const short = (m: Month) => monthLabel(m).slice(0, 3)
  return (
    <nav aria-label="Month" className="flex items-center justify-between gap-2">
      <button type="button" onClick={() => onMonth(prev)} aria-label={`Previous month, ${monthLabel(prev)}`} className={stepButton}>
        <ChevronLeft aria-hidden="true" className="size-7" />
        {short(prev)}
      </button>
      <h2 aria-live="polite" className="text-center text-2xl font-bold">
        {monthLabel(month)}
      </h2>
      <button
        type="button"
        onClick={() => onMonth(next)}
        disabled={month >= thisMonth}
        aria-label={`Next month, ${monthLabel(next)}`}
        className={stepButton}
      >
        {short(next)}
        <ChevronRight aria-hidden="true" className="size-7" />
      </button>
    </nav>
  )
}

function MemberFilter({ members, filter, onFilter }: { members: Member[]; filter: string | null; onFilter: (id: string | null) => void }) {
  const chip = (selected: boolean) =>
    'inline-flex min-h-touch min-w-touch items-center justify-center gap-2 rounded-full px-5 text-lg font-semibold ' +
    'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform ' +
    (selected ? 'bg-mocha text-warm-white' : 'bg-sand text-mocha')
  const options: { id: string | null; label: string }[] = [{ id: null, label: 'Everyone' }, ...members.map((m) => ({ id: m.memberId, label: m.name }))]
  return (
    <section className="flex flex-col gap-3">
      <h2 id="filter-title" className="text-lg font-semibold">
        Paid by
      </h2>
      <div role="group" aria-labelledby="filter-title" className="flex flex-wrap gap-3">
        {options.map((o) => (
          <button key={o.id ?? '*'} type="button" aria-pressed={filter === o.id} onClick={() => onFilter(o.id)} className={chip(filter === o.id)}>
            {filter === o.id && <Check aria-hidden="true" className="size-6" />}
            {o.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-sand p-5">
      <h2 className="flex items-center gap-3 text-xl font-bold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A bar for spend against a Budget; nothing when there is no Budget. Terracotta once over. */
function BudgetBar({ bar }: { bar: Bar }) {
  if (bar.fraction === null) return null
  return (
    <div aria-hidden="true" className="h-5 w-full overflow-hidden rounded-full bg-warm-white">
      <div
        className={'h-full rounded-full ' + (bar.over ? 'bg-terracotta' : 'bg-olive-sage')}
        style={{ width: `${Math.min(bar.fraction, 1) * 100}%` }}
      />
    </div>
  )
}

function barWords(bar: Bar): string {
  if (bar.fraction === null) return `${formatRupees(bar.spent)} spent, no Budget`
  return `${formatRupees(bar.spent)} of ${formatRupees(bar.budget)}`
}

function OverLine({ bar }: { bar: Bar }) {
  if (bar.fraction === null) return null
  if (!bar.over) return <span className="tabular-nums">{Math.round(bar.fraction * 100)}%</span>
  return (
    <span className="flex items-center gap-1 font-bold">
      <TriangleAlert aria-hidden="true" className="size-6 shrink-0 text-terracotta" />
      {formatRupees(Math.round((bar.spent - bar.budget) * 100) / 100)} over
    </span>
  )
}

function BurnRatePanel({ burn, who }: { burn: ReturnType<typeof burnRates>; who: string | null }) {
  const h = burn.household
  return (
    <Panel title={who ? `Spent by ${who}` : 'Household this month'}>
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-lg">
          <span className="text-2xl font-bold tabular-nums">{formatRupees(h.spent)}</span>
          {h.fraction !== null && <span>of {formatRupees(h.budget)} Budget</span>}
        </p>
        <BudgetBar bar={h} />
        <p className="flex justify-end text-lg">
          {h.fraction === null ? 'No Budgets set in the Ledger yet.' : <OverLine bar={h} />}
        </p>
      </div>

      <h3 className="text-lg font-semibold">Burn Rate by Category</h3>
      <ul className="flex flex-col gap-4">
        {burn.categories
          // A Category with no Budget and nothing spent has nothing to show.
          .filter((c) => c.fraction !== null || c.count > 0)
          .map((c) => (
            <li key={c.name} className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-lg font-semibold">
                <span aria-hidden="true" className="text-2xl">
                  {c.emoji}
                </span>
                {c.name}
              </p>
              <BudgetBar bar={c} />
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-lg tabular-nums">
                <span>{barWords(c)}</span>
                <OverLine bar={c} />
              </p>
            </li>
          ))}
      </ul>
    </Panel>
  )
}

function BreakdownPanel({ burn, who }: { burn: ReturnType<typeof burnRates>; who: string | null }) {
  const rows = breakdown(burn)
  return (
    <Panel title="Category breakdown">
      {rows.length === 0 ? (
        <p className="text-lg">{who ? `${who} paid for nothing this month.` : 'Nothing spent this month yet.'}</p>
      ) : (
        <ul className="flex flex-col divide-y-2 divide-warm-white">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3 py-3">
              <span aria-hidden="true" className="text-2xl">
                {r.emoji}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-lg font-semibold">{r.name}</span>
                <span className="text-base">
                  {r.count} {r.count === 1 ? 'Expense' : 'Expenses'} · {Math.round(r.share * 100)}%
                </span>
              </span>
              <span className="text-lg font-bold tabular-nums">{formatRupees(r.spent)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function DuePanel({
  due,
  month,
  hasRules,
  categories,
  today,
  onLog,
}: {
  due: ReturnType<typeof dueNotLogged>
  month: Month
  hasRules: boolean
  categories: Category[]
  today: string
  onLog: (prefill: Partial<ExpenseDraft>) => void
}) {
  return (
    <Panel title="Due this month, not logged" icon={<CalendarClock aria-hidden="true" className="size-7 shrink-0" />}>
      {!hasRules ? (
        <p className="text-lg">No Recurring Rules yet. Add rent or school fees on the Recurring_Rules tab of the Ledger.</p>
      ) : due.length === 0 ? (
        <p className="flex items-center gap-2 text-lg">
          <CircleCheck aria-hidden="true" className="size-7 shrink-0 text-olive-sage" />
          Everything due in {monthLabel(month)} is logged.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {due.map(({ rule, dueDate }) => (
            <li key={rule.ruleId}>
              <button
                type="button"
                onClick={() => onLog(prefillFromRule(rule, dueDate, categories, today))}
                aria-label={`Log ${rule.title}, ${formatRupees(rule.amount)}, due ${dayLabel(dueDate, today)}`}
                className={
                  'flex min-h-touch w-full items-center gap-4 rounded-2xl bg-warm-white p-4 text-left ' +
                  'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'
                }
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-lg font-bold">{rule.title}</span>
                  <span className="text-lg tabular-nums">
                    {formatRupees(rule.amount)} · {rule.category}
                  </span>
                  <span className="text-base">Due {dayLabel(dueDate, today)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-lg font-semibold">
                  <Keyboard aria-hidden="true" className="size-6" />
                  Log
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function QueuePanel({
  queue,
  members,
  categories,
  today,
  onUnpaired,
}: {
  queue: ReturnType<typeof reimbursableQueue>
  members: Member[]
  categories: Category[]
  today: string
  onUnpaired: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function markDone(expense: Expense) {
    setBusy(expense.id)
    setErrors(({ [expense.id]: _, ...rest }) => rest)
    try {
      await markPaidBack(expense)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onUnpaired()
      const message =
        err instanceof ApiError && err.code === 'EXPENSE_NOT_FOUND'
          ? 'This Expense was deleted on another phone.'
          : err instanceof ApiError
            ? `Not marked: ${err.message}`
            : 'Not marked: could not reach the server. Try again.'
      setErrors((e) => ({ ...e, [expense.id]: message }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title="Reimbursable Queue" icon={<HandCoins aria-hidden="true" className="size-7 shrink-0" />}>
      {queue.length === 0 ? (
        <p className="text-lg">Nobody is waiting to be paid back.</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {queue.map((g) => (
            <li key={g.memberId} className="flex flex-col gap-3">
              <h3 className="flex items-baseline justify-between gap-3 text-lg">
                <span className="font-bold">{g.name} is owed</span>
                <span className="font-bold tabular-nums">{formatRupees(g.total)}</span>
              </h3>
              <ul className="flex flex-col gap-3">
                {g.expenses.map((e) => (
                  <li key={e.id} className="flex flex-col gap-3 rounded-2xl bg-warm-white p-4">
                    <ExpenseSummary expense={e} members={members} categories={categories} today={today} />
                    <Button
                      icon={busy === e.id ? CircleDashed : Check}
                      disabled={busy !== null}
                      onClick={() => void markDone(e)}
                      aria-label={`Mark done: ${g.name} paid back ${formatRupees(e.amount)} for ${e.category}`}
                      className="w-full"
                    >
                      {busy === e.id ? 'Marking…' : 'Mark done'}
                    </Button>
                    {errors[e.id] && (
                      <p role="alert" className="flex items-start gap-2 text-lg">
                        <TriangleAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-terracotta" />
                        {errors[e.id]}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ExpenseSummary({
  expense,
  members,
  categories,
  today,
  onSand = false,
}: {
  expense: Expense
  members: Member[]
  categories: Category[]
  today: string
  /** The row is Sand, so the emoji sits on Warm White. */
  onSand?: boolean
}) {
  const name = (id: string) => members.find((m) => m.memberId === id)?.name ?? 'Unknown'
  const emoji = categories.find((c) => categoryKey(c.name) === categoryKey(expense.category))?.emoji ?? '📦'
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span role="img" aria-label={expense.category} className={'flex size-12 shrink-0 items-center justify-center rounded-full text-2xl ' + (onSand ? 'bg-warm-white' : 'bg-sand')}>
        {emoji}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-lg font-bold tabular-nums">{formatRupees(expense.amount)}</span>
          <span className="shrink-0 text-base">{dayLabel(expense.expenseDate, today)}</span>
        </span>
        <span className="truncate text-base">{expense.merchantNote || expense.category}</span>
        {receiptNumberLine(expense) && <span className="truncate text-base">{receiptNumberLine(expense)}</span>}
        <span className="text-base">
          {expense.paidBy === expense.loggedBy ? `By ${name(expense.loggedBy)}` : `Logged by ${name(expense.loggedBy)}, paid by ${name(expense.paidBy)}`}
        </span>
      </span>
    </div>
  )
}

function MonthExpenses({
  expenses,
  month,
  who,
  members,
  categories,
  today,
  onEdit,
}: {
  expenses: Expense[]
  month: Month
  who: string | null
  members: Member[]
  categories: Category[]
  today: string
  onEdit: (expense: Expense) => void
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">
        {who ? `Paid by ${who}` : 'Every Expense'} in {monthLabel(month)}
      </h2>
      {expenses.length > 0 && <p className="text-lg">Tap one to fix or delete it.</p>}
      {expenses.length === 0 ? (
        <p className="rounded-2xl bg-sand p-4 text-lg">No Expenses this month.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {expenses.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onEdit(e)}
                aria-label={`Edit ${formatRupees(e.amount)} for ${e.category}, ${dayLabel(e.expenseDate, today)}`}
                className={
                  'flex min-h-touch w-full items-center gap-3 rounded-2xl bg-sand p-4 text-left ' +
                  'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'
                }
              >
                <ExpenseSummary expense={e} members={members} categories={categories} today={today} onSand />
                <Pencil aria-hidden="true" className="size-7 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type RepairState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; lines: string[]; warnings: string[] }
  | { kind: 'failed'; message: string }

/** Repair: run Bootstrap again and say what it put back (user story 64). */
function RepairButton({ onUnpaired }: { onUnpaired: () => void }) {
  const [state, setState] = useState<RepairState>({ kind: 'idle' })

  async function repair() {
    setState({ kind: 'running' })
    try {
      const report = await runBootstrap()
      setState({ kind: 'done', lines: repairSummary(report), warnings: repairWarnings(report) })
      void queryClient.invalidateQueries({ queryKey: readModelKey })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onUnpaired()
      setState({ kind: 'failed', message: err instanceof Error ? err.message : 'Could not reach the server.' })
    }
  }

  return (
    <>
      <Button
        icon={state.kind === 'running' ? CircleDashed : Wrench}
        variant="secondary"
        disabled={state.kind === 'running'}
        onClick={() => void repair()}
        className="w-full"
      >
        {state.kind === 'running' ? 'Repairing…' : 'Repair the Ledger and Drive folder'}
      </Button>
      <div role="status" className="empty:hidden">
        {state.kind === 'done' && (
          <ul className="flex flex-col gap-2 rounded-2xl bg-sand p-4 text-lg">
            {state.lines.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <CircleCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-olive-sage" />
                {line}
              </li>
            ))}
            {state.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-terracotta" />
                {warning}
              </li>
            ))}
          </ul>
        )}
        {state.kind === 'failed' && (
          <p className="flex items-start gap-2 rounded-2xl bg-sand p-4 text-lg">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-terracotta" />
            Repair failed: {state.message}
          </p>
        )}
      </div>
    </>
  )
}
