import { CircleDashed, Mic, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './components/Button'
import type { VoiceResult } from './components/VoiceEntry'
import { ApiError, getSessionState, type Expense } from './lib/api'
import { setBusy } from './lib/appUpdate'
import { forgetMember, rememberMember, rememberedMemberId } from './lib/device'
import { takePairToken } from './lib/installPrompt'
import { backgroundTimer, memberAfterAdmin, startingMember } from './lib/adminLock'
import { monthOf, type Month } from './lib/month'
import type { ExpenseDraft } from './lib/quickExpense'
import { queryClient, readModelKey, useReadModel } from './lib/readModel'
import { AdminMode } from './screens/AdminMode'
import { Gatekeeper } from './screens/Gatekeeper'
import { PairDevice } from './screens/PairDevice'
import { ProfileSwitcher } from './screens/ProfileSwitcher'
import { EditExpense } from './screens/EditExpense'
import { QuickExpense } from './screens/QuickExpense'
import { ScanReceipt } from './screens/ScanReceipt'
import { SimpleMode } from './screens/SimpleMode'

type Boot =
  | { status: 'checking' }
  | { status: 'unpaired' }
  | { status: 'paired' }
  | { status: 'unreachable' }

/** A read model kept on the device (ticket 09) means this phone was paired and has something to show. */
const hasKeptReadModel = () => queryClient.getQueryData(readModelKey) !== undefined

/**
 * Boot: ask the `auth` function whether this device holds a Session, then
 * show the Gatekeeper or the paired app. A paired device sees a neutral
 * splash while the answer is on its way and never the Gatekeeper; one with
 * a kept read model opens straight away (offline too) while it is asked.
 */
export default function App() {
  const [boot, setBoot] = useState<Boot>(() => (hasKeptReadModel() ? { status: 'paired' } : { status: 'checking' }))

  const check = useCallback(async () => {
    try {
      const { paired } = await getSessionState()
      // Already paired: a QR link's pairToken has nothing to do; drop it from the address.
      if (paired) takePairToken()
      setBoot({ status: paired ? 'paired' : 'unpaired' })
    } catch {
      // The server did not answer (offline, or a platform error). Not the
      // Gatekeeper: a paired phone must never be asked to pair again. With
      // a kept read model it is still useful.
      setBoot({ status: hasKeptReadModel() ? 'paired' : 'unreachable' })
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  switch (boot.status) {
    case 'checking':
      return <Splash label="Opening…" />
    case 'unpaired':
      return <Gatekeeper onPaired={() => setBoot({ status: 'paired' })} />
    case 'paired':
      return <PairedApp onUnpaired={() => setBoot({ status: 'unpaired' })} />
    case 'unreachable':
      return (
        <Unreachable
          onRetry={() => {
            setBoot({ status: 'checking' })
            void check()
          }}
        />
      )
  }
}

type View =
  | { kind: 'home'; justSaved: Expense | null; justDeleted?: Expense | null }
  /** `prefill` comes from a due Recurring Rule in Admin Mode. */
  | { kind: 'quickExpense'; voice?: VoiceResult; prefill?: Partial<ExpenseDraft> }
  | { kind: 'scanReceipt' }
  /** Edit or delete one Expense; Admin Mode opens any Expense here. */
  | { kind: 'edit'; expense: Expense }

/**
 * A paired device: Bootstrap once, load the read model, then either the
 * remembered Member's Simple Mode or the profile switcher. A 401 means the
 * Session is gone (secret rotated): back to the Gatekeeper.
 *
 * An Admin who passes the PIN gets Admin Mode for as long as the app stays
 * open, and is never remembered: a reload, Switch Member, or five minutes
 * in the background asks for the PIN again (ADR-0002). The last non-Admin
 * Member is kept in memory so the lock returns the device to them.
 */
function PairedApp({ onUnpaired }: { onUnpaired: () => void }) {
  const model = useReadModel()
  const [memberId, setMemberId] = useState<string | null>(() => rememberedMemberId())
  const [lastNonAdminId, setLastNonAdminId] = useState<string | null>(() => rememberedMemberId())
  const [adminId, setAdminId] = useState<string | null>(null)
  const [adminView, setAdminView] = useState<{ month: Month; filter: string | null }>(() => ({ month: monthOf(new Date()), filter: null }))
  const [view, setView] = useState<View>({ kind: 'home', justSaved: null })
  /** The Admin's pairing modal, drawn over Admin Mode; closed whenever Admin Mode closes. */
  const [pairOpen, setPairOpen] = useState(false)

  const unpaired = model.error instanceof ApiError && model.error.status === 401
  useEffect(() => {
    if (unpaired) onUnpaired()
  }, [unpaired, onUnpaired])
  // Each view starts at the top, like a new page.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view.kind])
  // A new version never reloads the app over a form or the pairing modal.
  useEffect(() => {
    setBusy(view.kind !== 'home' || pairOpen)
    return () => setBusy(false)
  }, [view.kind, pairOpen])

  // Five minutes in the background closes Admin Mode (user story 12).
  const members = model.data?.members
  const membersRef = useRef(members)
  membersRef.current = members
  useEffect(() => {
    if (adminId === null) return
    const timer = backgroundTimer()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        timer.hidden(Date.now())
      } else if (timer.visible(Date.now())) {
        const back = memberAfterAdmin(membersRef.current ?? [], lastNonAdminId)
        setAdminId(null)
        setPairOpen(false)
        setMemberId(back?.memberId ?? null)
        if (back) rememberMember(back.memberId)
        setView({ kind: 'home', justSaved: null })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [adminId, lastNonAdminId])

  if (model.isPending) return <Splash label="Loading the Household…" />
  // A failed background refetch (after a save) keeps the data on screen.
  if (model.isError && !model.data) return <LoadFailed error={model.error} onRetry={() => void model.refetch()} />

  const { ledgerUrl } = model.data
  const admin = model.data.members.find((m) => m.memberId === adminId && m.role === 'admin')
  const current = admin ?? startingMember(model.data.members, memberId)
  if (!current) {
    return (
      <ProfileSwitcher
        members={model.data.members}
        ledgerUrl={ledgerUrl}
        onSelect={(member) => {
          setView({ kind: 'home', justSaved: null })
          if (member.role === 'admin') {
            // PIN typed: Admin Mode until the app closes or locks. Not remembered.
            setAdminId(member.memberId)
            setAdminView({ month: monthOf(new Date()), filter: null })
            return
          }
          rememberMember(member.memberId)
          setMemberId(member.memberId)
          setLastNonAdminId(member.memberId)
        }}
      />
    )
  }
  const home = (done: Partial<Extract<View, { kind: 'home' }>> = {}) => setView({ kind: 'home', justSaved: null, ...done })
  const switchMember = () => {
    forgetMember()
    setAdminId(null)
    setPairOpen(false)
    setMemberId(null)
    home()
  }
  if (view.kind === 'edit') {
    return (
      <EditExpense
        member={current}
        model={model.data}
        expense={view.expense}
        onSaved={(expense) => home({ justSaved: expense })}
        onDeleted={(expense) => home({ justDeleted: expense })}
        onCancel={() => home()}
        onUnpaired={onUnpaired}
      />
    )
  }
  if (view.kind === 'quickExpense') {
    return (
      <QuickExpense
        member={current}
        model={model.data}
        prefill={view.prefill ?? (view.voice?.kind === 'heard' ? view.voice.prefill : undefined)}
        notice={view.voice && <VoiceNotice result={view.voice} />}
        onSaved={(expense) => home({ justSaved: expense })}
        onCancel={() => home()}
        onUnpaired={onUnpaired}
      />
    )
  }
  if (view.kind === 'scanReceipt') {
    return (
      <ScanReceipt
        member={current}
        model={model.data}
        onSaved={(expense) => home({ justSaved: expense })}
        onCancel={() => home()}
        onUnpaired={onUnpaired}
      />
    )
  }
  if (current.role === 'admin') {
    return (
      <>
        <AdminMode
          member={current}
          model={model.data}
          month={adminView.month}
          onMonth={(month) => setAdminView((v) => ({ ...v, month }))}
          filter={adminView.filter}
          onFilter={(filter) => setAdminView((v) => ({ ...v, filter }))}
          justSaved={view.justSaved}
          justDeleted={view.justDeleted ?? null}
          onQuickExpense={(prefill) => setView({ kind: 'quickExpense', prefill })}
          onScanReceipt={() => setView({ kind: 'scanReceipt' })}
          onEdit={(expense) => setView({ kind: 'edit', expense })}
          onPairDevice={() => setPairOpen(true)}
          onSwitch={switchMember}
          onUnpaired={onUnpaired}
        />
        {pairOpen && <PairDevice onClose={() => setPairOpen(false)} onUnpaired={onUnpaired} />}
      </>
    )
  }
  return (
    <SimpleMode
      member={current}
      members={model.data.members}
      categories={model.data.categories}
      expenses={model.data.expenses}
      justSaved={view.justSaved}
      justDeleted={view.justDeleted}
      onScanReceipt={() => setView({ kind: 'scanReceipt' })}
      onQuickExpense={() => setView({ kind: 'quickExpense' })}
      onVoice={(voice) => setView({ kind: 'quickExpense', voice })}
      onEdit={(expense) => setView({ kind: 'edit', expense })}
      onSwitch={switchMember}
    />
  )
}

/** What voice entry heard (so a misheard word is easy to spot), or why it failed. */
function VoiceNotice({ result }: { result: VoiceResult }) {
  if (result.kind === 'failed') {
    return (
      <p role="alert" className="flex items-start gap-3 text-lg text-terracotta">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-7 shrink-0" />
        {result.message}
      </p>
    )
  }
  return (
    <p role="status" className="flex items-start gap-3 rounded-2xl bg-sand p-4 text-lg">
      <Mic aria-hidden="true" className="mt-0.5 size-7 shrink-0 text-olive-sage" />
      <span>
        Heard “{result.transcript}”. Check it and tap Save.
      </span>
    </p>
  )
}

function Splash({ label }: { label: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 py-10">
      <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
      <p aria-live="polite" className="flex items-center gap-3 text-xl">
        <CircleDashed aria-hidden="true" className="size-8 shrink-0 animate-spin text-brass" />
        {label}
      </p>
    </main>
  )
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Could not reach the server</h1>
      </header>
      <p role="alert" className="flex items-start gap-3 text-xl text-terracotta">
        <TriangleAlert aria-hidden="true" className="mt-1 size-8 shrink-0" />
        Check the connection and try again.
      </p>
      <Button icon={RefreshCw} onClick={onRetry} className="w-full">
        Try again
      </Button>
    </main>
  )
}

/** The read model (or Bootstrap before it) failed with a definite answer. */
function LoadFailed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const misconfigured = error instanceof ApiError && error.code === 'SERVER_MISCONFIGURED'
  const title = misconfigured ? 'The server is not set up yet' : 'Could not load the Household'
  const hint = misconfigured
    ? 'The Admin needs to finish the setup guide and add the Google settings to the deployment.'
    : 'Check the connection and try again.'
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">{title}</h1>
      </header>
      <p role="alert" className="flex items-start gap-3 text-xl text-terracotta">
        <TriangleAlert aria-hidden="true" className="mt-1 size-8 shrink-0" />
        {hint}
      </p>
      <p className="break-words rounded-2xl bg-sand p-4 text-base">{error.message}</p>
      <Button icon={RefreshCw} onClick={onRetry} className="w-full">
        Try again
      </Button>
    </main>
  )
}
