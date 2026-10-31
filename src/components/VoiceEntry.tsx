import { Mic, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Category, Member } from '../lib/api'
import { setSpeechLanguage, speechLanguage, type SpeechLanguage } from '../lib/device'
import { visibleCategories, type ExpenseDraft } from '../lib/quickExpense'
import { failureMessage, listen, recognitionCtor } from '../lib/speech'
import { parseTranscript } from '../lib/voiceParser'
import { Button } from './Button'

/** What a voice attempt hands to Quick Expense: a prefill and what was heard, or a one-line failure. */
export type VoiceResult = { kind: 'heard'; transcript: string; prefill: Partial<ExpenseDraft> } | { kind: 'failed'; message: string }

const LANGUAGES: { lang: SpeechLanguage; label: string; example: string }[] = [
  { lang: 'en-IN', label: 'English', example: '“Paid 450 rupees for medicines by UPI”' },
  { lang: 'hi-IN', label: 'हिन्दी', example: '“दवाई के लिए 450 रुपये यूपीआई से”' },
]

type Props = {
  member: Member
  categories: Category[]
  onResult: (result: VoiceResult) => void
}

/**
 * The Simple Mode mic (spec: "Voice"): absent when the browser has no
 * speech recognition (iOS home-screen apps, older browsers), otherwise a
 * large mic button and the device's language toggle. Tapping starts
 * listening right in the tap handler and covers the screen with a large
 * listening state until a result, an error, or Cancel. Nothing is saved:
 * the result only prefills Quick Expense.
 */
export function VoiceEntry({ member, categories, onResult }: Props) {
  const [ctor] = useState(() => recognitionCtor())
  const [lang, setLang] = useState<SpeechLanguage>(() => speechLanguage())
  const [listening, setListening] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  // Leaving Simple Mode mid-listen (switch Member, unpair) stops the mic.
  useEffect(() => () => cancelRef.current?.(), [])

  if (!ctor) return null

  function start() {
    if (!ctor || cancelRef.current) return
    const attempt = listen({ ctor, lang })
    cancelRef.current = attempt.cancel
    setListening(true)
    void attempt.outcome.then((outcome) => {
      cancelRef.current = null
      setListening(false)
      if (outcome.kind === 'heard') {
        const prefill = parseTranscript(outcome.transcript, visibleCategories(categories, member.role))
        onResult({ kind: 'heard', transcript: outcome.transcript, prefill })
      } else if (outcome.kind === 'failed') {
        onResult({ kind: 'failed', message: failureMessage(outcome.reason) })
      }
    })
  }

  function choose(next: SpeechLanguage) {
    setLang(next)
    setSpeechLanguage(next)
  }

  const current = LANGUAGES.find((l) => l.lang === lang) ?? LANGUAGES[0]!
  const chip = (selected: boolean) =>
    'inline-flex min-h-touch min-w-touch flex-1 items-center justify-center rounded-full px-5 text-lg font-semibold ' +
    'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform ' +
    (selected ? 'bg-mocha text-warm-white' : 'bg-sand text-mocha')

  return (
    <section aria-label="Speak an Expense" className="flex flex-col gap-3">
      <button
        type="button"
        onClick={start}
        className={
          'flex min-h-24 items-center gap-4 rounded-3xl border-4 border-olive-sage bg-warm-white px-5 text-xl font-bold text-mocha ' +
          'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'
        }
      >
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-olive-sage text-warm-white">
          <Mic aria-hidden="true" className="size-9" strokeWidth={2} />
        </span>
        Speak an Expense
      </button>
      <div role="group" aria-label="Voice language" className="flex gap-3">
        {LANGUAGES.map((l) => (
          <button key={l.lang} type="button" lang={l.lang} aria-pressed={lang === l.lang} onClick={() => choose(l.lang)} className={chip(lang === l.lang)}>
            {l.label}
          </button>
        ))}
      </div>

      {listening && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Listening"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-mocha px-5 py-10 text-center text-warm-white"
        >
          <span className="relative flex size-44 items-center justify-center">
            <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-olive-sage opacity-60" />
            <span className="relative flex size-44 items-center justify-center rounded-full bg-olive-sage">
              <Mic aria-hidden="true" className="size-24" strokeWidth={2} />
            </span>
          </span>
          <p aria-live="assertive" className="text-4xl font-bold">
            Listening…
          </p>
          <div className="flex max-w-sm flex-col gap-2 text-xl">
            <p>Say the amount, what it was for, and how you paid.</p>
            <p lang={current.lang} className="font-semibold">
              {current.example}
            </p>
            <p className="text-lg">Language: {current.label}</p>
          </div>
          <Button icon={X} variant="secondary" onClick={() => cancelRef.current?.()} className="w-full max-w-sm">
            Cancel
          </Button>
        </div>
      )}
    </section>
  )
}
