import { afterEach, describe, expect, test, vi } from 'vitest'
import { listen, recognitionCtor, type RecognitionLike } from './speech'

/** A stand-in for the browser's SpeechRecognition that the test drives by hand. */
class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition | null = null
  lang = ''
  continuous = true
  interimResults = true
  maxAlternatives = 5
  onresult: RecognitionLike['onresult'] = null
  onerror: RecognitionLike['onerror'] = null
  onend: RecognitionLike['onend'] = null
  started = 0
  stopped = 0
  aborted = 0

  constructor() {
    FakeRecognition.last = this
  }
  start() {
    this.started++
  }
  stop() {
    this.stopped++
    this.onend?.()
  }
  abort() {
    this.aborted++
    this.onerror?.({ error: 'aborted' })
    this.onend?.()
  }
  hear(transcript: string, isFinal = true) {
    this.onresult?.({ results: [Object.assign([{ transcript }], { isFinal })] })
  }
  fail(error: string) {
    this.onerror?.({ error })
    this.onend?.()
  }
}

function fake(): FakeRecognition {
  const rec = FakeRecognition.last
  if (!rec) throw new Error('listen did not create a recognition')
  return rec
}

afterEach(() => {
  FakeRecognition.last = null
  vi.useRealTimers()
})

describe('recognitionCtor', () => {
  test('finds the unprefixed API, then the webkit one, else nothing', () => {
    class A {}
    class B {}
    expect(recognitionCtor({ SpeechRecognition: A, webkitSpeechRecognition: B })).toBe(A)
    expect(recognitionCtor({ webkitSpeechRecognition: B })).toBe(B)
    expect(recognitionCtor({})).toBeNull()
  })
})

describe('listen', () => {
  test('starts one final-result recognition in the chosen language', () => {
    listen({ ctor: FakeRecognition, lang: 'hi-IN' })
    expect(fake()).toMatchObject({ lang: 'hi-IN', continuous: false, interimResults: false, maxAlternatives: 1, started: 1 })
  })

  test('a final result is what was heard, and recognition stops', async () => {
    const { outcome } = listen({ ctor: FakeRecognition, lang: 'en-IN' })
    fake().hear(' Paid 450 rupees for medicines by UPI ')
    await expect(outcome).resolves.toEqual({ kind: 'heard', transcript: 'Paid 450 rupees for medicines by UPI' })
    expect(fake().stopped).toBe(1)
  })

  test('an interim result still counts when recognition ends without a final one', async () => {
    const { outcome } = listen({ ctor: FakeRecognition, lang: 'en-IN' })
    fake().hear('450 cash', false)
    fake().onend?.()
    await expect(outcome).resolves.toEqual({ kind: 'heard', transcript: '450 cash' })
  })

  test('ending with nothing heard is "no speech"', async () => {
    const { outcome } = listen({ ctor: FakeRecognition, lang: 'en-IN' })
    fake().onend?.()
    await expect(outcome).resolves.toEqual({ kind: 'failed', reason: 'no-speech' })
  })

  test.each([
    ['not-allowed', 'not-allowed'],
    ['service-not-allowed', 'speech-off'],
    ['no-speech', 'no-speech'],
    ['network', 'network'],
    ['audio-capture', 'no-microphone'],
    ['language-not-supported', 'language'],
    ['aborted', 'other'],
    ['bad-grammar', 'other'],
  ])('the browser error %s is the failure %s', async (error, reason) => {
    const { outcome } = listen({ ctor: FakeRecognition, lang: 'en-IN' })
    fake().fail(error)
    await expect(outcome).resolves.toEqual({ kind: 'failed', reason })
  })

  test('a start that throws is a failure, not a crash', async () => {
    class Throws extends FakeRecognition {
      override start(): void {
        throw new DOMException('already started', 'InvalidStateError')
      }
    }
    await expect(listen({ ctor: Throws, lang: 'en-IN' }).outcome).resolves.toEqual({ kind: 'failed', reason: 'other' })
  })

  test('cancel aborts and reports cancelled, whatever the browser says after', async () => {
    const { outcome, cancel } = listen({ ctor: FakeRecognition, lang: 'en-IN' })
    cancel()
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' })
    expect(fake().aborted).toBe(1)
  })

  test('the first outcome sticks', async () => {
    const { outcome, cancel } = listen({ ctor: FakeRecognition, lang: 'en-IN' })
    fake().hear('450 cash')
    fake().fail('network')
    cancel()
    await expect(outcome).resolves.toEqual({ kind: 'heard', transcript: '450 cash' })
  })

  test('a recognition that never ends on its own is stopped after the time limit', async () => {
    vi.useFakeTimers()
    const { outcome } = listen({ ctor: FakeRecognition, lang: 'en-IN', timeoutMs: 15_000 })
    fake().hear('450', false)
    vi.advanceTimersByTime(14_999)
    expect(fake().stopped).toBe(0)
    vi.advanceTimersByTime(1)
    expect(fake().stopped).toBe(1)
    await expect(outcome).resolves.toEqual({ kind: 'heard', transcript: '450' })
  })
})
