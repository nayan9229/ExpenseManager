import { Camera, Check, CircleCheck, Keyboard, Pencil, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { UpdateBanner } from '../components/UpdateBanner'
import { IosInstallSteps } from '../components/IosInstallSteps'
import { NEEDS_ATTENTION, OfflineQueuePanel, QueueBadge, SAVED_ON_PHONE } from '../components/OfflineQueuePanel'
import { ReceiptLightbox } from '../components/ReceiptLightbox'
import { ReceiptThumb } from '../components/ReceiptThumb'
import { VoiceEntry, type VoiceResult } from '../components/VoiceEntry'
import type { Category, Expense, Member } from '../lib/api'
import { dismissInstallHint, installHintDismissed } from '../lib/device'
import { canEdit } from '../lib/editExpense'
import { currentInstallPlatform } from '../lib/installPrompt'
import { showsInstallHintInSimpleMode } from '../lib/pairing'
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
  const [viewing, setViewing] = useState<Expense | null>(null)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <UpdateBanner />
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

      <InstallHint />

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
                onViewReceipt={() => setViewing(e)}
              />
            ))}
          </ul>
        )}
      </section>

      <Button icon={Users} variant="secondary" onClick={onSwitch} className="mt-auto w-full">
        Switch Member
      </Button>

      {viewing && (
        <ReceiptLightbox
          fileId={viewing.driveFileId}
          driveViewUrl={viewing.driveViewUrl}
          title={`Receipt for ${formatRupees(viewing.amount)}, ${viewing.category}`}
          onClose={() => setViewing(null)}
        />
      )}
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
  onViewReceipt,
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
  /** Opens the ReceiptLightbox; only used when the Expense has a Receipt. */
  onViewReceipt: () => void
}) {
  const paidBy = expense.paidBy !== member.memberId ? (members.find((m) => m.memberId === expense.paidBy)?.name ?? 'Unknown') : null
  const body = (
    <>
      {/* With a Receipt, its thumbnail beside the row is the picture; the emoji would crowd the amount. */}
      {!expense.driveFileId && (
        <span
          role="img"
          aria-label={expense.category}
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-warm-white text-3xl"
        >
          {category?.emoji ?? '📦'}
        </span>
      )}
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
  const row = 'flex min-h-touch w-full min-w-0 flex-1 items-center gap-4 rounded-2xl bg-sand p-4 text-left'
  return (
    <li className="flex items-stretch gap-3">
      {expense.driveFileId && (
        <ReceiptThumb
          fileId={expense.driveFileId}
          label={`View the Receipt for ${formatRupees(expense.amount)}, ${expense.category}`}
          onOpen={onViewReceipt}
        />
      )}
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

/**
 * The iPhone "Add to Home Screen" steps for a device paired in the browser
 * (a scanned QR link pairs Safari). Safari can clear a site's storage after
 * a week without use, and the Home Screen app keeps its own storage, so the
 * app is better installed and paired once more there. Shown until dismissed
 * on this device; never in the Home Screen app itself.
 */
function InstallHint() {
  const [platform] = useState(() => currentInstallPlatform())
  const [dismissed, setDismissed] = useState(() => installHintDismissed())
  if (platform !== 'ios-safari' && platform !== 'ios-other-browser') return null
  if (!showsInstallHintInSimpleMode({ platform, dismissed })) return null
  return (
    <IosInstallSteps
      platform={platform}
      afterInstall={
        <>
          Open <strong>Expenses</strong> from the Home Screen. It asks to be paired once more: ask the Admin for a Pair
          Code.
        </>
      }
    >
      <p className="text-base">What you log here is saved either way.</p>
      <Button
        icon={Check}
        onClick={() => {
          dismissInstallHint()
          setDismissed(true)
        }}
        className="w-full"
      >
        Got it, hide this
      </Button>
    </IosInstallSteps>
  )
}
