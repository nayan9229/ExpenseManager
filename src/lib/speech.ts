/**
 * A thin wrapper over the browser's speech recognition for voice entry
 * (spec: "Voice"). Chrome has it unprefixed (139+) and as
 * `webkitSpeechRecognition`; iOS Safari only prefixed (14.5+, needs Siri);
 * iOS home-screen apps do not have it at all (docs/research/
 * mobile-browser-capabilities.md, question 3). So: feature-detect, never
 * assume, and turn every way it can end into one outcome.
 */

/** The part of SpeechRecognition voice entry uses. */
export type RecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type RecognitionCtor = new () => RecognitionLike

/** The speech recognition constructor this browser has, or null (no mic button). */
export function recognitionCtor(scope: object = globalThis): RecognitionCtor | null {
  const s = scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  const ctor = s.SpeechRecognition ?? s.webkitSpeechRecognition
  return typeof ctor === 'function' ? (ctor as RecognitionCtor) : null
}

export type ListenFailure = 'not-allowed' | 'speech-off' | 'no-speech' | 'network' | 'no-microphone' | 'language' | 'other'

export type ListenOutcome =
  | { kind: 'heard'; transcript: string }
  | { kind: 'failed'; reason: ListenFailure }
  | { kind: 'cancelled' }

const FAILURES: Record<string, ListenFailure> = {
  'not-allowed': 'not-allowed',
  // iOS: Siri and Dictation are switched off.
  'service-not-allowed': 'speech-off',
  'no-speech': 'no-speech',
  network: 'network',
  'audio-capture': 'no-microphone',
  'language-not-supported': 'language',
}

/** One line for the Quick Expense form when listening failed. */
export function failureMessage(reason: ListenFailure): string {
  switch (reason) {
    case 'not-allowed':
      return 'The microphone is not allowed for this app. Type the Expense instead.'
    case 'speech-off':
      return 'Speech is switched off on this phone (Siri & Dictation). Type the Expense instead.'
    case 'no-speech':
      return 'Did not hear anything. Type the Expense instead.'
    case 'network':
      return 'Voice needs the internet. Type the Expense instead.'
    case 'no-microphone':
      return 'No microphone found. Type the Expense instead.'
    case 'language':
      return 'This phone cannot listen in that language. Type the Expense instead.'
    case 'other':
      return 'Voice did not work this time. Type the Expense instead.'
  }
}

type ListenOptions = {
  ctor: RecognitionCtor
  lang: string
  /** Stop listening after this long even if the browser keeps going. */
  timeoutMs?: number
}

/**
 * Listens for one utterance. Call it from the tap handler: the microphone
 * prompt belongs to the gesture. `cancel` aborts (the outcome is then
 * `cancelled`); the first outcome sticks.
 */
export function listen({ ctor, lang, timeoutMs = 15_000 }: ListenOptions): {
  outcome: Promise<ListenOutcome>
  cancel: () => void
} {
  let settle!: (o: ListenOutcome) => void
  let settled = false
  const outcome = new Promise<ListenOutcome>((resolve) => {
    settle = (o) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(o)
    }
  })

  const rec = new ctor()
  rec.lang = lang
  rec.continuous = false
  rec.interimResults = false
  rec.maxAlternatives = 1

  // Safari has been seen to deliver results that are not final; keep the
  // latest so an end without a final result still counts what was heard.
  let latest = ''
  rec.onresult = (event) => {
    const results = Array.from(event.results)
    latest = results
      .map((r) => r[0]?.transcript ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (latest && results.every((r) => r.isFinal)) {
      settle({ kind: 'heard', transcript: latest })
      rec.stop()
    }
  }
  rec.onerror = (event) => settle({ kind: 'failed', reason: FAILURES[event.error] ?? 'other' })
  rec.onend = () => settle(latest ? { kind: 'heard', transcript: latest } : { kind: 'failed', reason: 'no-speech' })

  const timer = setTimeout(() => rec.stop(), timeoutMs)
  try {
    rec.start()
  } catch {
    settle({ kind: 'failed', reason: 'other' })
  }

  return {
    outcome,
    cancel: () => {
      if (settled) return
      settle({ kind: 'cancelled' })
      try {
        rec.abort()
      } catch {
        // Already ended: nothing to abort.
      }
    },
  }
}
