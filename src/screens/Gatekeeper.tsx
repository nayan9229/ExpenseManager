import { KeyRound, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/Button'
import { ApiError, pairDevice } from '../lib/api'

type Attempt = { status: 'idle' } | { status: 'pairing' } | { status: 'failed'; message: string }

const WRONG_CODE = "That code didn't work"
const UNREACHABLE = 'Could not reach the server. Check the connection and try again.'

/**
 * The screen an unpaired device sees (GLOSSARY: Gatekeeper). One large
 * field for the Household Access Code, one labelled button, and a slow,
 * plain "That code didn't work" on a miss. Pair Tokens from a QR link or a
 * typed Pair Code join this screen in ticket 12.
 */
export function Gatekeeper({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('')
  const [attempt, setAttempt] = useState<Attempt>({ status: 'idle' })
  const field = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const accessCode = code.trim()
    if (!accessCode) {
      field.current?.focus()
      return
    }
    setAttempt({ status: 'pairing' })
    try {
      await pairDevice(accessCode)
      onPaired()
    } catch (err) {
      const wrongCode = err instanceof ApiError && err.status === 401
      setAttempt({ status: 'failed', message: wrongCode ? WRONG_CODE : UNREACHABLE })
      field.current?.focus()
    }
  }

  const pairing = attempt.status === 'pairing'

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Pair this phone</h1>
        <p className="text-lg">Type the Household Access Code the Admin gave you. You only do this once.</p>
      </header>

      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="text-lg font-semibold">Household Access Code</span>
          <input
            ref={field}
            name="accessCode"
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              if (attempt.status === 'failed') setAttempt({ status: 'idle' })
            }}
            disabled={pairing}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-invalid={attempt.status === 'failed'}
            aria-describedby="access-code-error"
            className={
              'min-h-touch w-full rounded-2xl border-2 bg-warm-white px-5 text-xl tracking-wide outline-none ' +
              'focus-visible:ring-4 focus-visible:ring-olive-sage disabled:opacity-50 ' +
              (attempt.status === 'failed' ? 'border-terracotta' : 'border-sand')
            }
          />
        </label>

        <p id="access-code-error" role="alert" aria-live="assertive" className="min-h-8 text-lg text-terracotta">
          {attempt.status === 'failed' && (
            <span className="flex items-start gap-2">
              <TriangleAlert aria-hidden="true" className="mt-1 size-6 shrink-0" />
              {attempt.message}
            </span>
          )}
        </p>

        <Button type="submit" icon={pairing ? LoaderCircle : KeyRound} disabled={pairing} className="w-full">
          {pairing ? 'Pairing…' : 'Pair this phone'}
        </Button>
      </form>

      {/*
        Reserved for the install-first hint (ticket 12): on iPhone, add the app
        to the Home Screen and pair inside it; on Android, an Install button.
      */}
      <section
        data-slot="install-hint"
        aria-label="How to install this app"
        className="mt-auto rounded-3xl border-2 border-dashed border-sand p-5 text-base"
      >
        Install instructions for this phone will appear here.
      </section>
    </main>
  )
}
