import { CircleDashed, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from './components/Button'
import { getSessionState } from './lib/api'
import { Gatekeeper } from './screens/Gatekeeper'
import { Home } from './screens/Home'

type Boot =
  | { status: 'checking' }
  | { status: 'unpaired' }
  | { status: 'paired' }
  | { status: 'unreachable' }

/**
 * Boot: ask the `auth` function whether this device holds a Session, then
 * show the Gatekeeper or the home screen. A paired device sees a neutral
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
      return <Splash />
    case 'unpaired':
      return <Gatekeeper onPaired={() => setBoot({ status: 'paired' })} />
    case 'paired':
      return <Home />
    case 'unreachable':
      return <Unreachable onRetry={() => void check()} />
  }
}

function Splash() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 py-10">
      <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
      <p aria-live="polite" className="flex items-center gap-3 text-xl">
        <CircleDashed aria-hidden="true" className="size-8 shrink-0 animate-spin text-brass" />
        Opening…
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
