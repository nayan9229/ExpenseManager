/**
 * The three places that name the environment variables, read as lists so a
 * test (envDocs.test.ts, part of `npm test` and CI) can keep them equal:
 * `.env.example`, the README's "Environment variables" table, and the Go
 * code that reads them.
 */

/** `NAME=` lines of `.env.example`, in file order (comments skipped). */
export function envExampleNames(text: string): string[] {
  return [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!)
}

/**
 * First-column names of the table under the README's "## Environment
 * variables" heading (rows like `| \`JWT_SECRET\` | ... |`), in order.
 */
export function readmeEnvNames(text: string): string[] {
  const start = text.search(/^## Environment variables\s*$/m)
  if (start < 0) return []
  const rest = text.slice(start).split('\n').slice(1).join('\n')
  const end = rest.search(/^## /m)
  const section = end < 0 ? rest : rest.slice(0, end)
  return [...section.matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/gm)].map((m) => m[1]!)
}
/**
 * Variables the Go code reads: `os.Getenv("NAME")`, `os.LookupEnv("NAME")`,
 * or a local `get("NAME")` wrapper around them (pkg/googleclient). Each name
 * once.
 */
export function goEnvNames(sources: string[]): string[] {
  const names = new Set<string>()
  for (const source of sources) {
    for (const m of source.matchAll(/\b(?:Getenv|LookupEnv|get)\("([A-Z][A-Z0-9_]*)"\)/g)) names.add(m[1]!)
  }
  return [...names]
}
