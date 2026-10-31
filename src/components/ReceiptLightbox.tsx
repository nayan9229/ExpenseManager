import { CircleDashed, ExternalLink, RotateCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '../lib/api'
import { loadReceiptView, type ReceiptView } from '../lib/receipts'
import { Button } from './Button'

type Props = {
  /** The Expense's Drive file ID. */
  fileId: string
  /** The Expense's Drive link, for PDFs and the oversize fallback. */
  driveViewUrl: string
  /** Read out with the dialog, e.g. "Receipt for ₹450, Groceries". */
  title: string
  /** "No. 004521/A" under the title, when the Expense has a Receipt Number. */
  subtitle?: string | null
  onClose: () => void
}

type Shown = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; view: ReceiptView; urls: Urls }
type Urls = { image?: string; thumb?: string }

function messageFor(err: unknown): string {
  if (err instanceof TypeError) return 'No internet. Try again when you are online.'
  if (err instanceof ApiError) {
    if (err.status === 404) return 'This receipt is no longer in Google Drive.'
    if (err.status === 401) return 'This phone needs pairing again. Close this and reopen the app.'
  }
  return 'The receipt could not be loaded. Please try again.'
}

/**
 * Full-screen Receipt viewer (spec "Receipt viewing", ADR-0003). Photos
 * fill the screen and can be pinch-zoomed; PDFs show Drive's first-page
 * thumbnail; Receipts over the proxy's 4 MB cap show the thumbnail and an
 * "Open in Google Drive" button. Close is a labelled 56px button at the top.
 */
export function ReceiptLightbox({ fileId, driveViewUrl, title, subtitle, onClose }: Props) {
  const [shown, setShown] = useState<Shown>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    const made: string[] = []
    setShown({ state: 'loading' })
    loadReceiptView(fileId, driveViewUrl)
      .then((view) => {
        if (!live) return
        const urls: Urls = {}
        const url = (b: Blob) => {
          const u = URL.createObjectURL(b)
          made.push(u)
          return u
        }
        if (view.kind === 'image') urls.image = url(view.image)
        else if (view.thumb) urls.thumb = url(view.thumb)
        setShown({ state: 'ready', view, urls })
      })
      .catch((err: unknown) => live && setShown({ state: 'error', message: messageFor(err) }))
    return () => {
      live = false
      made.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [fileId, driveViewUrl, attempt])

  // Escape closes; the page behind does not scroll; focus starts on Close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-mocha text-warm-white">
      <div className="flex shrink-0 items-center justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-lg font-semibold">{title}</p>
          {subtitle && <p className="truncate text-lg">{subtitle}</p>}
        </div>
        <Button autoFocus icon={X} variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      {/* Pinch-zoom stays on: the viewport is scalable and touch-action allows it. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [touch-action:pan-x_pan-y_pinch-zoom]">
        {shown.state === 'loading' && (
          <p role="status" className="flex items-center gap-3 text-2xl font-semibold">
            <CircleDashed aria-hidden="true" className="size-9 shrink-0 animate-spin text-brass" />
            Loading the receipt…
          </p>
        )}

        {shown.state === 'error' && (
          <>
            <p role="alert" className="max-w-sm text-center text-2xl font-semibold">
              {shown.message}
            </p>
            <Button icon={RotateCw} variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </>
        )}

        {shown.state === 'ready' && <ViewBody view={shown.view} urls={shown.urls} />}
      </div>
    </div>
  )
}

function ViewBody({ view, urls }: { view: ReceiptView; urls: Urls }) {
  if (view.kind === 'image') {
    return <img src={urls.image} alt="The receipt" className="max-h-full max-w-full object-contain" />
  }
  const note =
    view.kind === 'pdf'
      ? 'This receipt is a PDF. Its first page is shown.'
      : view.kind === 'tooLarge'
        ? 'This receipt is too large to show here.'
        : 'You are offline. This is a small preview.'
  return (
    <>
      {urls.thumb ? (
        <img src={urls.thumb} alt="Preview of the receipt" className="max-h-[60dvh] max-w-full rounded-xl bg-warm-white object-contain" />
      ) : (
        <p className="text-xl">No preview yet.</p>
      )}
      <p className="max-w-sm text-center text-2xl font-semibold">{note}</p>
      {view.kind !== 'offline' && view.driveUrl && (
        <a
          href={view.driveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={
            'inline-flex min-h-touch min-w-touch items-center justify-center gap-3 rounded-2xl bg-sand px-6 py-3 ' +
            'text-lg font-semibold leading-tight text-mocha outline-none focus-visible:ring-4 focus-visible:ring-olive-sage'
          }
        >
          <ExternalLink aria-hidden="true" className="size-7 shrink-0" strokeWidth={2.25} />
          <span>Open in Google Drive</span>
        </a>
      )}
    </>
  )
}
