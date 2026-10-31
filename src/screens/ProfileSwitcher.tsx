import { ArrowLeft, Delete, ExternalLink, LockKeyhole, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import type { Member } from '../lib/api'
import { verifyPin } from '../lib/pin'

type Props = {
  members: Member[]
  ledgerUrl: string
  onSelect: (member: Member) => void
}

type View = { kind: 'tiles' } | { kind: 'pin'; member: Member } | { kind: 'pinNotSet'; member: Member }

/**
 * One large tile per Member (user stories 9, 10, 14). A Member without a
 * PIN is selected on one tap; a Member with a PIN (every Admin) types it
 * on a large keypad, checked against `pinHash` on the device (ADR-0002).
 * An Admin whose PIN is still blank in the Ledger is told so (story 13).
 */
export function ProfileSwitcher({ members, ledgerUrl, onSelect }: Props) {
  const [view, setView] = useState<View>({ kind: 'tiles' })

  function tap(member: Member) {
    if (member.pinHash !== null) {
      setView({ kind: 'pin', member })
    } else if (member.role === 'admin') {
      setView({ kind: 'pinNotSet', member })
    } else {
      onSelect(member)
    }
  }

  const back = () => setView({ kind: 'tiles' })

  if (view.kind === 'pin') {
    return <PinEntry member={view.member} onBack={back} onVerified={() => onSelect(view.member)} />
  }
  if (view.kind === 'pinNotSet') {
    return <AdminPinNotSet member={view.member} ledgerUrl={ledgerUrl} onBack={back} />
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Who are you?</h1>
      </header>

      {members.length === 0 ? (
        <NoMembers ledgerUrl={ledgerUrl} />
      ) : (
        <ul className="grid grid-cols-2 gap-4">
          {members.map((member) => (
            <li key={member.memberId}>
              <MemberTile member={member} onTap={() => tap(member)} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function MemberTile({ member, onTap }: { member: Member; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={member.pinHash !== null ? `${member.name}, PIN required` : member.name}
      className={
        'flex min-h-touch w-full flex-col items-center gap-3 rounded-3xl bg-sand p-5 ' +
        'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'
      }
    >
      <span
        aria-hidden="true"
        style={{ backgroundColor: member.avatarColor, color: textOn(member.avatarColor) }}
        className="flex size-20 items-center justify-center rounded-full text-4xl font-bold"
      >
        {initialOf(member.name)}
      </span>
      <span className="flex items-center gap-2 text-xl font-semibold leading-tight">
        {member.pinHash !== null && <LockKeyhole aria-hidden="true" className="size-5 shrink-0 text-brass" />}
        {member.name}
      </span>
    </button>
  )
}

function NoMembers({ ledgerUrl }: { ledgerUrl: string }) {
  return (
    <section role="alert" className="flex flex-col gap-5 rounded-3xl bg-sand p-6">
      <p className="flex items-start gap-3 text-xl">
        <TriangleAlert aria-hidden="true" className="mt-1 size-8 shrink-0 text-terracotta" />
        The Ledger has no Members yet. Add one on the Members tab.
      </p>
      <OpenLedgerButton ledgerUrl={ledgerUrl} />
    </section>
  )
}

function AdminPinNotSet({ member, ledgerUrl, onBack }: { member: Member; ledgerUrl: string; onBack: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">Admin PIN not set</h1>
      </header>

      <section role="alert" className="flex flex-col gap-5 rounded-3xl bg-sand p-6">
        <p className="flex items-start gap-3 text-xl">
          <TriangleAlert aria-hidden="true" className="mt-1 size-8 shrink-0 text-terracotta" />
          {member.name} has no PIN in the Ledger yet. Open it, find the Members tab, type a 4-digit PIN in the
          PIN_Code cell, then come back and tap the avatar again.
        </p>
        <OpenLedgerButton ledgerUrl={ledgerUrl} />
      </section>

      <Button icon={ArrowLeft} variant="secondary" onClick={onBack} className="w-full">
        Back
      </Button>
    </main>
  )
}

function OpenLedgerButton({ ledgerUrl }: { ledgerUrl: string }) {
  return (
    <Button
      icon={ExternalLink}
      disabled={ledgerUrl === ''}
      onClick={() => window.open(ledgerUrl, '_blank', 'noopener,noreferrer')}
      className="w-full"
    >
      Open the Ledger
    </Button>
  )
}

const PIN_LENGTH = 4
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function PinEntry({ member, onBack, onVerified }: { member: Member; onBack: () => void; onVerified: () => void }) {
  const [digits, setDigits] = useState('')
  const [wrong, setWrong] = useState(false)
  const [checking, setChecking] = useState(false)

  async function press(digit: string) {
    if (checking) return
    setWrong(false)
    const next = digits + digit
    setDigits(next)
    if (next.length < PIN_LENGTH) return
    setChecking(true)
    const ok = await verifyPin(member, next)
    setChecking(false)
    if (ok) {
      onVerified()
    } else {
      setWrong(true)
      setDigits('')
    }
  }

  function erase() {
    if (checking) return
    setWrong(false)
    setDigits((d) => d.slice(0, -1))
  }

  const key =
    'flex h-20 items-center justify-center rounded-2xl bg-sand text-3xl font-semibold select-none ' +
    'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.96] transition-transform ' +
    'disabled:opacity-50'

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Family Expenses</p>
        <h1 className="text-3xl font-bold leading-tight">PIN for {member.name}</h1>
      </header>

      <div aria-label={`${digits.length} of ${PIN_LENGTH} digits entered`} className="flex justify-center gap-5">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={'size-6 rounded-full border-4 border-mocha ' + (i < digits.length ? 'bg-mocha' : 'bg-transparent')}
          />
        ))}
      </div>

      <p role="alert" aria-live="assertive" className="min-h-8 text-center text-lg text-terracotta">
        {wrong && 'Wrong PIN. Try again.'}
      </p>

      <div role="group" aria-label="PIN keypad" className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button key={k} type="button" disabled={checking} onClick={() => void press(k)} className={key}>
            {k}
          </button>
        ))}
        <span aria-hidden="true" />
        <button type="button" disabled={checking} onClick={() => void press('0')} className={key}>
          0
        </button>
        <button type="button" disabled={checking} onClick={erase} aria-label="Erase last digit" className={key}>
          <Delete aria-hidden="true" className="size-8" />
        </button>
      </div>

      <Button icon={ArrowLeft} variant="secondary" onClick={onBack} className="mt-auto w-full">
        Back
      </Button>
    </main>
  )
}

function initialOf(name: string): string {
  const first = Array.from(name.trim())[0]
  return first ? first.toUpperCase() : '?'
}

/**
 * Mocha or Warm White, whichever reads on the avatar colour. Sand and Brass
 * are light enough that white text would fail AAA.
 */
function textOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#F3EDE1'
  const [r, g, b] = [m[1], m[2], m[3]].map((c) => parseInt(c ?? '00', 16) / 255)
  const luminance = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
  return luminance > 0.4 ? '#4A3728' : '#F3EDE1'
}
