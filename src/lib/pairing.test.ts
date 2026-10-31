import { describe, expect, test } from 'vitest'
import { countdown, formatPairCode, installPlatform, normalisePairCode, pairTokenFromUrl } from './pairing'

describe('pairTokenFromUrl', () => {
  test('takes the pairToken from the QR link and leaves a clean address', () => {
    expect(pairTokenFromUrl('https://family.example/?pairToken=ABCD2345')).toEqual({ token: 'ABCD2345', cleanUrl: '/' })
  })

  test('keeps the rest of the address as it was', () => {
    expect(pairTokenFromUrl('https://family.example/app?x=1&pairToken=ABCD2345&y=2#top')).toEqual({
      token: 'ABCD2345',
      cleanUrl: '/app?x=1&y=2#top',
    })
  })

  test('an address without a pairToken has nothing to take', () => {
    expect(pairTokenFromUrl('https://family.example/?x=1')).toEqual({ token: null, cleanUrl: '/?x=1' })
  })

  test('an empty pairToken is stripped but not used', () => {
    expect(pairTokenFromUrl('https://family.example/?pairToken=')).toEqual({ token: null, cleanUrl: '/' })
  })
})

describe('normalisePairCode', () => {
  test.each([
    ['abcd-2345', 'ABCD2345'],
    [' ab cd 23 45 ', 'ABCD2345'],
    ['ABCD–2345', 'ABCD2345'], // en dash from a phone keyboard
    ['oO0-iIlL1', '00011111'], // look-alikes become the digits the code uses
    ['ABCD-2345-EXTRA', 'ABCD2345'], // never longer than a code
  ])('%s -> %s', (typed, code) => {
    expect(normalisePairCode(typed)).toBe(code)
  })
})

describe('formatPairCode', () => {
  test.each([
    ['ABCD2345', 'ABCD-2345'],
    ['abcd2345', 'ABCD-2345'],
    ['', ''],
    ['abc', 'ABC'],
    ['ABCD', 'ABCD'],
    ['abcde', 'ABCD-E'],
    ['ABCD-', 'ABCD'],
  ])('%s shows as %s', (typed, shown) => {
    expect(formatPairCode(typed)).toBe(shown)
  })
})

describe('countdown', () => {
  const expiresAt = '2026-10-31T12:20:00Z'
  const at = (iso: string) => Date.parse(iso)

  test('shows minutes and seconds left', () => {
    expect(countdown(expiresAt, at('2026-10-31T12:05:30Z'))).toEqual({ secondsLeft: 870, label: '14:30', expired: false })
  })

  test('pads the seconds and rounds a part second up', () => {
    expect(countdown(expiresAt, at('2026-10-31T12:19:50.400Z'))).toEqual({ secondsLeft: 10, label: '0:10', expired: false })
  })

  test('is expired at the expiry moment and after it, never negative', () => {
    expect(countdown(expiresAt, at('2026-10-31T12:20:00Z'))).toEqual({ secondsLeft: 0, label: '0:00', expired: true })
    expect(countdown(expiresAt, at('2026-10-31T12:30:00Z'))).toEqual({ secondsLeft: 0, label: '0:00', expired: true })
  })

  test('an unreadable expiry counts as expired', () => {
    expect(countdown('soon', at('2026-10-31T12:00:00Z')).expired).toBe(true)
  })
})

describe('installPlatform', () => {
  const ua = {
    iphoneSafari:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    iphoneChrome:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
    iphoneInstagram:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85',
    // iPadOS Safari asks for the desktop site and says it is a Mac.
    ipadSafari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
    androidChrome:
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
    desktopChrome:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  }

  test.each([
    ['iPhone Safari', ua.iphoneSafari, 5, 'ios-safari'],
    ['iPad Safari (desktop site)', ua.ipadSafari, 5, 'ios-safari'],
    ['Mac Safari', ua.ipadSafari, 0, 'other'],
    ['iPhone Chrome', ua.iphoneChrome, 5, 'ios-other-browser'],
    ['iPhone Instagram in-app browser', ua.iphoneInstagram, 5, 'ios-other-browser'],
    ['Android Chrome', ua.androidChrome, 5, 'android'],
    ['desktop Chrome', ua.desktopChrome, 0, 'other'],
  ] as const)('%s', (_, userAgent, maxTouchPoints, platform) => {
    expect(installPlatform({ userAgent, maxTouchPoints, standalone: false })).toBe(platform)
  })

  test('an app already opened from the home screen needs no install steps', () => {
    expect(installPlatform({ userAgent: ua.iphoneSafari, maxTouchPoints: 5, standalone: true })).toBe('installed')
    expect(installPlatform({ userAgent: ua.androidChrome, maxTouchPoints: 5, standalone: true })).toBe('installed')
  })
})
