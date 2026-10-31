import { CircleDashed, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from './components/Button'
import { ApiError, getSessionState } from './lib/api'
import { forgetMember, rememberMember, rememberedMemberId } from './lib/device'
import { useReadModel } from './lib/readModel'
import { Gatekeeper } from './screens/Gatekeeper'
import { Home } from './screens/Home'
import { ProfileSwitcher } from './screens/ProfileSwitcher'

type Boot =
  | { status: 'checking' }
  | { status: 'unpaired' }
  | { status: 'paired' }
  | { status: 'unreachable' }

/**
 * Boot: ask the `auth` function whether this device holds a Session, then
 * show the Gatekeeper or the paired app. A paired device sees a neutral
 * splash while the answer is on its way and never the Gatekeeper.
 */
export default function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'checking' })

  const check = useCallback(async () => {
    setBoot({ status: 'checking' })
    try {
      const { paired } = await getSessionState()
      setBoot({ status: paired ? 'paired' : 'unpaired' })
    } catch {
      // The server did not answer (offline, or a platform error). Not the
      // Gatekeeper: a paired phone must never be asked to pair again.
      setBoot({ status: 'unreachable' })
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
      return <Unreachable onRetry={() => void check()} />
  }
}

/**
 * A paired device: Bootstrap once, load the read model, then either the
 * remembered Member's home or the profile switcher. A 401 means the Session
 * is gone (secret rotated): back to the Gatekeeper.
 */
function PairedApp({ onUnpaired }: { onUnpaired: () => void }) {
  const model = useReadModel()
  const [memberId, setMemberId] = useState<string | null>(() => rememberedMemberId())

  const unpaired = model.error instanceof ApiError && model.error.status === 401
  useEffect(() => {
    if (unpaired) onUnpaired()
  }, [unpaired, onUnpaired])

  if (model.isPending) return <Splash label="Loading the Household…" />
  if (model.isError) return <LoadFailed error={model.error} onRetry={() => void model.refetch()} />

  const { members, ledgerUrl } = model.data
  const current = members.find((m) => m.memberId === memberId)
  if (!current) {
    return (
      <ProfileSwitcher
        members={members}
        ledgerUrl={ledgerUrl}
        onSelect={(member) => {
          rememberMember(member.memberId)
          setMemberId(member.memberId)
        }}
      />
    )
  }
  return (
    <Home
      member={current}
      onSwitch={() => {
        forgetMember()
        setMemberId(null)
      }}
    />
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
