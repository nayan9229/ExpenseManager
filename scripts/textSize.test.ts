import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = new URL('..', import.meta.url).pathname

/** Every UI source file: components, screens and the app shell. */
function uiSources(): { file: string; text: string }[] {
  return readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ file: f, text: readFileSync(join(root, 'src', f), 'utf8') }))
}

describe('text size (spec "Design system": 18px minimum)', () => {
  test('the root font size is 18px, so text-base is the smallest text', () => {
    expect(readFileSync(join(root, 'src/app.css'), 'utf8')).toMatch(/html\s*\{[^}]*font-size:\s*18px/)
  })

  test('no UI text uses a Tailwind size below text-base or a pixel size below 18', () => {
    const offenders = uiSources().flatMap(({ file, text }) =>
      [...text.matchAll(/\btext-(xs|sm|\[(\d+(?:\.\d+)?)px\]|\[0?\.\d+rem\])/g)]
        .filter((m) => m[2] === undefined || Number(m[2]) < 18)
        .map((m) => `${file}: ${m[0]}`),
    )
    expect(offenders).toEqual([])
  })
})
