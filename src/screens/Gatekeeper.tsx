import { Download, EllipsisVertical, Hash, KeyRound, LoaderCircle, Share, SquarePlus, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { ApiError, pairDevice, pairWithCode } from '../lib/api'
import { currentInstallPlatform, takePairToken, useInstallPrompt } from '../lib/installPrompt'
import { formatPairCode, normalisePairCode, PAIR_CODE_LENGTH, type InstallPlatform } from '../lib/pairing'

/** Which field an attempt came from; `link` is the `pairToken` of a QR link. */
type Source = 'pairCode' | 'accessCode' | 'link'

type Attempt = { status: 'idle' } | { status: 'pairing'; source: Source } | { status: 'failed'; source: Source; message: string }

const WRONG_CODE = "That code didn't work"
const STALE_LINK = 'That pairing link has expired. Ask the Admin for a new code and type it here.'
const SHORT_CODE = `A Pair Code has ${PAIR_CODE_LENGTH} letters and numbers`
const UNREACHABLE = 'Could not reach the server. Check the connection and try again.'

const fieldClass =
  'min-h-touch w-full rounded-2xl border-2 bg-warm-white px-5 outline-none ' +
  'focus-visible:ring-4 focus-visible:ring-olive-sage disabled:opacity-50 '

/**
 * The screen an unpaired device sees (GLOSSARY: Gatekeeper). It pairs with
 * a Pair Code (typed, or the `pairToken` of the Admin's QR link, taken from
 * the address on load) or the Household Access Code, and explains how to
 * install the app on this phone first.
 */
export function Gatekeeper({ onPaired }: { onPaired: () => void }) {
  const [pairCode, setPairCode] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [attempt, setAttempt] = useState<Attempt>({ status: 'idle' })
  const pairField = useRef<HTMLInputElement>(null)
  const accessField = useRef<HTMLInputElement>(null)
  const [platform] = useState<InstallPlatform>(() => currentInstallPlatform())

  async function tryPairing(source: Source, code: string) {
    setAttempt({ status: 'pairing', source })
    try {
      if (source === 'accessCode') await pairDevice(code)
      else await pairWithCode(code)
      onPaired()
    } catch (err) {
      const wrong = err instanceof ApiError && err.status === 401
      const message = !wrong ? UNREACHABLE : source === 'link' ? STALE_LINK : WRONG_CODE
      setAttempt({ status: 'failed', source, message })
      if (source === 'accessCode') accessField.current?.focus()
      else pairField.current?.focus()
    }
  }

  // A QR link opens the app as /?pairToken=CODE: pair with it straight away.
  useEffect(() => {
    const token = takePairToken()
    if (token === null) return
    setPairCode(formatPairCode(token))
    void tryPairing('link', token)
    // Once on load; tryPairing only touches setters and refs.
  }, [])

  function submitPairCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = normalisePairCode(pairCode)
    if (code.length < PAIR_CODE_LENGTH) {
      setAttempt({ status: 'failed', source: 'pairCode', message: SHORT_CODE })
      pairField.current?.focus()
      return
    }
    void tryPairing('pairCode', code)
  }

  function submitAccessCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = accessCode.trim()
    if (!code) {
      accessField.current?.focus()
      return
    }
    void tryPairing('accessCode', code)
  }

  const pairing = attempt.status === 'pairing'
  const failedOn = (source: 'pairCode' | 'accessCode') =>
    attempt.status === 'failed' && (attempt.source === source || (source === 'pairCode' && attempt.source === 'link'))
  const clearFailure = () => {
    if (attempt.status === 'failed') setAttempt({ status: 'idle' })
  }
  const busyOn = (source: 'pairCode' | 'accessCode') =>
    attempt.status === 'pairing' && (attempt.source === source || (source === 'pairCode' && attempt.source === 'link'))

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Pair this phone</h1>
        <p className="text-lg">
          Type the Pair Code shown on the Admin's phone, or the Household Access Code. You only do this once.
        </p>
      </header>

      <InstallHint platform={platform} />

      <form onSubmit={submitPairCode} noValidate className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-lg font-semibold">Pair Code</span>
          <input
            ref={pairField}
            name="pairCode"
            type="text"
            inputMode="text"
            value={pairCode}
            placeholder="XXXX-XXXX"
            onChange={(e) => {
              setPairCode(formatPairCode(e.target.value))
              clearFailure()
            }}
            disabled={pairing}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-invalid={failedOn('pairCode')}
            aria-describedby="pair-code-error"
            className={
              fieldClass +
              'px-3 py-3 text-center font-mono text-3xl font-bold uppercase tracking-[0.15em] placeholder:text-sand ' +
              (failedOn('pairCode') ? 'border-terracotta' : 'border-sand')
            }
          />
        </label>
        <ErrorLine id="pair-code-error">{failedOn('pairCode') && attempt.status === 'failed' && attempt.message}</ErrorLine>
        <Button type="submit" icon={busyOn('pairCode') ? LoaderCircle : Hash} disabled={pairing} className="w-full">
          {busyOn('pairCode') ? 'Pairing…' : 'Pair with this code'}
        </Button>
      </form>

      <form onSubmit={submitAccessCode} noValidate className="flex flex-col gap-4 border-t-2 border-sand pt-8">
        <label className="flex flex-col gap-2">
          <span className="text-lg font-semibold">Or the Household Access Code</span>
          <input
            ref={accessField}
            name="accessCode"
            type="text"
            value={accessCode}
            onChange={(e) => {
              setAccessCode(e.target.value)
              clearFailure()
            }}
            disabled={pairing}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-invalid={failedOn('accessCode')}
            aria-describedby="access-code-error"
            className={fieldClass + 'text-xl tracking-wide ' + (failedOn('accessCode') ? 'border-terracotta' : 'border-sand')}
          />
        </label>
        <ErrorLine id="access-code-error">{failedOn('accessCode') && attempt.status === 'failed' && attempt.message}</ErrorLine>
        <Button type="submit" variant="secondary" icon={busyOn('accessCode') ? LoaderCircle : KeyRound} disabled={pairing} className="w-full">
          {busyOn('accessCode') ? 'Pairing…' : 'Pair with the Access Code'}
        </Button>
      </form>
    </main>
  )
}

/** The reserved error line under a field; `min-h-8` keeps the layout still. */
function ErrorLine({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" aria-live="assertive" className="min-h-8 text-lg text-terracotta">
      {children && (
        <span className="flex items-start gap-2">
          <TriangleAlert aria-hidden="true" className="mt-1 size-6 shrink-0" />
          {children}
        </span>
      )}
    </p>
  )
}

/**
 * Install first, then pair inside the installed app (spec "Simple Mode",
 * user stories 4 and 5). An iPhone home-screen app keeps its own storage,
 * apart from Safari, so a Session made in Safari is not there; Android's
 * installed app shares Chrome's cookies, so pairing in either is enough.
 */
function InstallHint({ platform }: { platform: InstallPlatform }) {
  const prompt = useInstallPrompt()
  const [outcome, setOutcome] = useState<'accepted' | 'dismissed' | null>(null)

  if (platform === 'installed' || platform === 'other') return null

  const box = 'flex flex-col gap-3 rounded-3xl bg-sand p-5 text-lg'
  if (platform === 'ios-safari') {
    return (
      <section aria-labelledby="install-title" className={box}>
        <h2 id="install-title" className="text-xl font-bold">
          First, add the app to your Home Screen
        </h2>
        <ol className="flex flex-col gap-3">
          <Step n={1}>
            Tap the Share button <Share aria-label="Share" className="inline size-6 align-text-bottom" /> at the bottom of
            Safari.
          </Step>
          <Step n={2}>
            Scroll down and tap <strong>Add to Home Screen</strong>{' '}
            <SquarePlus aria-hidden="true" className="inline size-6 align-text-bottom" />.
          </Step>
          <Step n={3}>
            Tap <strong>Add</strong>.
          </Step>
          <Step n={4}>Open Family Expenses from the Home Screen and type the Pair Code there.</Step>
        </ol>
        <p className="text-base">Pairing here in Safari does not carry over to the Home Screen app.</p>
      </section>
    )
  }
  if (platform === 'ios-other-browser') {
    return (
      <section aria-labelledby="install-title" className={box}>
        <h2 id="install-title" className="text-xl font-bold">
          First, add the app to your Home Screen
        </h2>
        <p>
          Open this page in <strong>Safari</strong>, tap Share <Share aria-label="Share" className="inline size-6 align-text-bottom" />,
          then <strong>Add to Home Screen</strong>. Open the app from the Home Screen and type the Pair Code there.
        </p>
      </section>
    )
  }
  // Android
  return (
    <section aria-labelledby="install-title" className={box}>
      <h2 id="install-title" className="text-xl font-bold">
        Put the app on your home screen
      </h2>
      {prompt.available ? (
        <Button
          icon={Download}
          onClick={() => void prompt.install().then(setOutcome)}
          className="w-full"
        >
          Install the app
        </Button>
      ) : outcome === 'accepted' ? (
        <p role="status">Installed. Pair here or in the app: on Android both share the pairing.</p>
      ) : (
        <p>
          Open the browser menu <EllipsisVertical aria-label="menu" className="inline size-6 align-text-bottom" /> and tap{' '}
          <strong>Install app</strong> or <strong>Add to Home screen</strong>. Pairing here also pairs the installed app.
        </p>
      )}
    </section>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mocha text-base font-bold text-warm-white"
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}
