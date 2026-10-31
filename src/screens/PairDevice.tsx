import { useQuery } from '@tanstack/react-query'
import { CircleDashed, RefreshCw, Smartphone, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { encode } from 'uqr'
import { Button } from '../components/Button'
import { ApiError, getPairToken } from '../lib/api'
import { countdown, formatPairCode } from '../lib/pairing'

/**
 * The Admin's pairing modal (user story 2): the QR link and the Pair Code
 * for the device being paired, how long the code still works, Refresh, and
 * the install-first hint. A new code is fetched by itself when the shown one
 * runs out. Rendered over Admin Mode, so the Admin lock closes it too.
 */
export function PairDevice({ onClose, onUnpaired }: { onClose: () => void; onUnpaired: () => void }) {
  const token = useQuery({
    queryKey: ['pairToken'],
    queryFn: () => getPairToken(),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const now = useNow()
  const left = token.data ? countdown(token.data.expiresAt, now) : null

  const unpaired = token.error instanceof ApiError && token.error.status === 401
  useEffect(() => {
    if (unpaired) onUnpaired()
  }, [unpaired, onUnpaired])

  // The shown code ran out: fetch the next one, once per code, so a phone
  // clock running ahead of the server cannot loop.
  const expiredAt = left?.expired ? token.data?.expiresAt : undefined
  const renewedFor = useRef<string | undefined>(undefined)
  const refetch = token.refetch
  useEffect(() => {
    if (expiredAt === undefined || renewedFor.current === expiredAt) return
    renewedFor.current = expiredAt
    void refetch()
  }, [expiredAt, refetch])

  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    dialog.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [])

  return (
    <div
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pair-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-warm-white outline-none"
    >
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 py-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold uppercase tracking-wide text-olive-sage">Admin</p>
            <h1 id="pair-title" className="text-2xl font-bold leading-tight">
              Pair a device
            </h1>
          </div>
          <Button icon={X} variant="secondary" onClick={onClose}>
            Close
          </Button>
        </header>

        <p className="flex items-center gap-3 rounded-2xl bg-sand px-4 py-3 text-lg font-bold">
          <Smartphone aria-hidden="true" className="size-7 shrink-0 text-olive-sage" />
          Install the app first, then pair inside it.
        </p>

        {token.data ? (
          <>
            <QrCodeImage value={token.data.url} />
            <div className="flex flex-col items-center gap-2">
              <p className="text-base font-semibold">Pair Code</p>
              <p
                aria-label={`Pair Code ${token.data.pairCode.split('').join(' ')}`}
                className="select-all whitespace-nowrap font-mono text-5xl font-bold tracking-wider min-[400px]:text-6xl"
              >
                {formatPairCode(token.data.pairCode)}
              </p>
              <p role="timer" aria-live="off" className="text-xl">
                {left && !left.expired ? (
                  <>
                    Works for <strong className="tabular-nums">{left.label}</strong> more
                  </>
                ) : (
                  'Getting a new code…'
                )}
              </p>
            </div>
          </>
        ) : token.isError && !unpaired ? (
          <p role="alert" className="flex items-start gap-3 text-xl text-terracotta">
            <TriangleAlert aria-hidden="true" className="mt-1 size-8 shrink-0" />
            Could not get a Pair Code. Check the connection and try again.
          </p>
        ) : (
          <p aria-live="polite" className="flex items-center justify-center gap-3 py-16 text-xl">
            <CircleDashed aria-hidden="true" className="size-8 shrink-0 animate-spin text-brass" />
            Getting a Pair Code…
          </p>
        )}

        <Button
          icon={token.isFetching ? CircleDashed : RefreshCw}
          variant="secondary"
          disabled={token.isFetching}
          onClick={() => void token.refetch()}
          className="w-full"
        >
          {token.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>

        <p className="text-lg">
          <strong>iPhone:</strong> add the app to the Home Screen (Share, then Add to Home Screen), open it, and type the
          code. <strong>Android:</strong> scan the QR code with the camera, or type the code. The code works on any number
          of devices until it runs out.
        </p>
      </div>
    </div>
  )
}

/** Ticks once a second for the countdown. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/**
 * The QR link as an SVG drawn from uqr's module matrix (no canvas, no
 * network). Mocha on Warm White with the standard four-module quiet zone;
 * crisp at any size.
 */
function QrCodeImage({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 4 })
    let d = ''
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { size: qr.size, path: d }
  }, [value])
  return (
    <svg
      role="img"
      aria-label="QR code that opens the app and pairs it"
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="mx-auto aspect-square w-full max-w-60 rounded-2xl bg-warm-white"
    >
      <rect width={size} height={size} className="fill-warm-white" />
      <path d={path} className="fill-mocha" />
    </svg>
  )
}
