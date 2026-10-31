import { CircleCheck, CircleDashed, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from './components/Button'
import { ApiError, getSessionState, type SessionState } from './lib/api'

type Check =
  | { status: 'checking' }
  | { status: 'done'; state: SessionState }
  | { status: 'failed'; message: string }

/**
 * Placeholder home for the walking skeleton: proves the shell talks to the
 * Go `auth` function. The Gatekeeper and Simple Mode replace it from ticket 02.
 */
export default function App() {
  const [check, setCheck] = useState<Check>({ status: 'checking' })

  const runCheck = useCallback(async () => {
    setCheck({ status: 'checking' })
    try {
      const state = await getSessionState()
      setCheck({ status: 'done', state })
    } catch (err) {
      const message = err instanceof ApiError ? `${err.message} (${err.code})` : 'Could not reach the server.'
      setCheck({ status: 'failed', message })
    }
  }, [])

  useEffect(() => {
    void runCheck()
  }, [runCheck])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Hello, family.</h1>
        <p className="text-lg">This is the app shell. Pairing and expenses arrive with the next tickets.</p>
      </header>

      <section aria-live="polite" className="rounded-3xl bg-sand p-6">
        <h2 className="mb-3 text-base font-semibold uppercase tracking-wide">This phone</h2>
        <SessionStatus check={check} />
      </section>

      <Button icon={RefreshCw} onClick={() => void runCheck()} disabled={check.status === 'checking'}>
        Check again
      </Button>
    </main>
  )
}

function SessionStatus({ check }: { check: Check }) {
  switch (check.status) {
    case 'checking':
      return (
        <p className="flex items-center gap-3 text-xl">
          <CircleDashed aria-hidden="true" className="size-8 shrink-0 animate-spin text-brass" />
          Asking the server…
        </p>
      )
    case 'done':
      return check.state.paired ? (
        <p className="flex items-center gap-3 text-xl">
          <CircleCheck aria-hidden="true" className="size-8 shrink-0 text-olive-sage" />
          Paired with the Household.
        </p>
      ) : (
        <p className="flex items-center gap-3 text-xl">
          <CircleDashed aria-hidden="true" className="size-8 shrink-0 text-brass" />
          Not paired yet. The server answered.
        </p>
      )
    case 'failed':
      return (
        <p className="flex items-center gap-3 text-xl text-terracotta">
          <TriangleAlert aria-hidden="true" className="size-8 shrink-0" />
          {check.message}
        </p>
      )
  }
}
