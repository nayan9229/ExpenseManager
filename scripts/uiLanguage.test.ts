import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = new URL('..', import.meta.url).pathname

/** The language toggle may name Hindi in its own script; nothing else in the UI is Hindi. */
const NATIVE_LANGUAGE_NAMES = ['हिन्दी']

describe('UI language (spec: English UI)', () => {
  test('no UI file shows Devanagari text other than the language toggle label', () => {
    const offenders = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx'))
      .flatMap((f) => {
        let text = readFileSync(join(root, 'src', f), 'utf8')
        for (const name of NATIVE_LANGUAGE_NAMES) text = text.replaceAll(`'${name}'`, "''")
        return [...text.matchAll(/[ऀ-ॿ][ऀ-ॿ\s]*/g)].map((m) => `${f}: ${m[0].trim()}`)
      })
    expect(offenders).toEqual([])
  })
})
