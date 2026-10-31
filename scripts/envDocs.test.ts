import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { envExampleNames, goEnvNames, readmeEnvNames } from './envDocs.ts'

const root = new URL('..', import.meta.url).pathname
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function goSources(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'))
    .map((f) => read(join(dir, f)))
}

describe('environment variables', () => {
  test('.env.example names the variables in the order a reader meets them', () => {
    expect(envExampleNames(read('.env.example'))).toEqual([
      'FAMILY_ACCESS_CODE',
      'JWT_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
      'GOOGLE_DRIVE_FOLDER_ID',
      'GOOGLE_SHEET_ID',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
    ])
  })

  test('the README documents exactly the variables in .env.example, in the same order', () => {
    expect(readmeEnvNames(read('README.md'))).toEqual(envExampleNames(read('.env.example')))
  })

  test('the backend reads exactly the variables in .env.example', () => {
    expect(goEnvNames([...goSources('pkg'), ...goSources('api')]).sort()).toEqual(envExampleNames(read('.env.example')).sort())
  })
})
