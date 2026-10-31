import { CircleCheck, Users } from 'lucide-react'
import { Button } from '../components/Button'
import type { Member } from '../lib/api'

/**
 * Placeholder home for a paired device with a Member selected. Simple Mode
 * (Scan, Quick Expense, mic, last five Expenses) replaces the body in the
 * next tickets; "Switch Member" stays.
 */
export function Home({ member, onSwitch }: { member: Member; onSwitch: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Hello, {member.name}.</h1>
      </header>

      <section className="rounded-3xl bg-sand p-6">
        <p className="flex items-center gap-3 text-xl">
          <CircleCheck aria-hidden="true" className="size-8 shrink-0 text-olive-sage" />
          This phone is paired with the Household and remembers you.
        </p>
      </section>

      <p className="text-lg">Logging Expenses arrives with the next tickets.</p>

      <Button icon={Users} variant="secondary" onClick={onSwitch} className="mt-auto w-full">
        Switch Member
      </Button>
    </main>
  )
}
