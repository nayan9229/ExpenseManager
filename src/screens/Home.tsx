import { CircleCheck } from 'lucide-react'

/**
 * Placeholder home for a paired device. Member selection and Simple Mode
 * (Scan, Quick Expense, last five Expenses) replace it in the next tickets.
 */
export function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Hello, family.</h1>
      </header>

      <section className="rounded-3xl bg-sand p-6">
        <p className="flex items-center gap-3 text-xl">
          <CircleCheck aria-hidden="true" className="size-8 shrink-0 text-olive-sage" />
          This phone is paired with the Household.
        </p>
      </section>

      <p className="text-lg">Choosing who you are and logging Expenses arrive with the next tickets.</p>
    </main>
  )
}
