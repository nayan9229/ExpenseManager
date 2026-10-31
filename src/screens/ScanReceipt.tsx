import { ArrowLeft, Camera, Check, CircleAlert, CircleCheck, CircleDashed, CloudOff, FileText, ImageIcon, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button } from '../components/Button'
import { ExpenseForm } from '../components/ExpenseForm'
import { ApiError, duplicateReceiptOf, type Expense, type Member, type ReadModel } from '../lib/api'
import { dayLabel, istToday } from '../lib/istDate'
import { newDraft, newExpenseId, toCreateInput, type ExpenseDraft } from '../lib/quickExpense'
import { saveExpense } from '../lib/readModel'
import { MAX_BYTES, NOT_A_RECEIPT, ReceiptRejected, receiptKind } from '../lib/receiptFile'
import { readyReceipt, sendReceipt, type AttachedReceipt, type ReadyReceipt } from '../lib/receiptPipeline'
import type { QueuedReceipt } from '../lib/db'
import { isTransient } from '../lib/offlineQueue'
import { formatRupees } from '../lib/rupees'
import { UploadFailed } from '../lib/upload'

type Props = {
  member: Member
  model: ReadModel
  onSaved: (expense: Expense) => void
  onCancel: () => void
  /** The Session is gone (401): back to the Gatekeeper. */
  onUnpaired: () => void
}

/**
 * Scan Receipt (user stories 25 to 36, OCR aside): pick a photo or PDF, and
 * the Expense form opens at once for manual entry while the Receipt is
 * shrunk and uploaded straight to Drive. Saving links it to the Expense.
 */
export function ScanReceipt({ member, model, onSaved, onCancel, onUnpaired }: Props) {
  const [file, setFile] = useState<File | null>(null)
  if (!file) return <ReceiptPicker onPick={setFile} onCancel={onCancel} />
  return <ReceiptExpense file={file} member={member} model={model} onSaved={onSaved} onCancel={onCancel} onUnpaired={onUnpaired} />
}

/** Camera first (it is what a parent wants nine times out of ten), then gallery, then PDF. */
function ReceiptPicker({ onPick, onCancel }: { onPick: (file: File) => void; onCancel: () => void }) {
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const pdf = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  function picked(e: ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0]
    // Cleared so picking the same file again still fires a change.
    e.target.value = ''
    if (!chosen) return
    if (!receiptKind(chosen)) {
      setError(NOT_A_RECEIPT)
      return
    }
    if (chosen.size > MAX_BYTES) {
      setError('This file is over 20 MB. Please choose a smaller photo or PDF.')
      return
    }
    setError(null)
    onPick(chosen)
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-8">
      <header className="flex items-center gap-3">
        <Button icon={ArrowLeft} variant="secondary" onClick={onCancel}>
          Back
        </Button>
        <h1 className="text-2xl font-bold leading-tight">Scan Receipt</h1>
      </header>

      {/* accept="image/*" on purpose: listing types makes iOS transcode (research section 2). */}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={picked} />
      <input ref={pdf} type="file" accept="application/pdf,.pdf" hidden onChange={picked} />

      <button
        type="button"
        onClick={() => camera.current?.click()}
        className={
          'flex min-h-48 flex-col items-center justify-center gap-4 rounded-3xl bg-mocha p-6 text-center text-2xl font-bold text-warm-white ' +
          'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'
        }
      >
        <Camera aria-hidden="true" className="size-16" strokeWidth={2} />
        Take a photo
      </button>
      <div className="flex flex-col gap-4">
        <Button icon={ImageIcon} variant="secondary" onClick={() => gallery.current?.click()} className="min-h-20 w-full text-xl">
          Choose from gallery
        </Button>
        <Button icon={FileText} variant="secondary" onClick={() => pdf.current?.click()} className="min-h-20 w-full text-xl">
          Choose a PDF
        </Button>
      </div>
      <p role="alert" className="min-h-8 text-xl font-semibold text-terracotta">
        {error && (
          <span className="flex items-start gap-3">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-7 shrink-0" />
            {error}
          </span>
        )}
      </p>
    </main>
  )
}

type Stage =
  | { kind: 'preparing' }
  | { kind: 'uploading'; fraction: number }
  | { kind: 'attached'; receipt: AttachedReceipt }
  | { kind: 'failed'; message: string; retryable: boolean }
  /** No signal: the prepared Receipt is kept and saved with the Expense into the Offline Queue. */
  | { kind: 'offline' }
  | { kind: 'removed' }

/** The duplicate the server found, and the draft to save if the user adds it anyway. */
type Duplicate = { expense: Expense; draft: ExpenseDraft }

function ReceiptExpense({ file, member, model, onSaved, onCancel, onUnpaired }: Props & { file: File }) {
  const [today] = useState(() => istToday())
  const [id] = useState(() => newExpenseId())
  const [initial] = useState(() => newDraft(member, today))
  const [stage, setStage] = useState<Stage>({ kind: 'preparing' })
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null)
  const panel = useRef<HTMLElement>(null)
  const ready = useRef<ReadyReceipt | null>(null)
  // Settles with the attached Receipt, or null when this try failed; Save awaits it.
  const pending = useRef<Promise<AttachedReceipt | null> | null>(null)
  const started = useRef(false)
  // True when the upload could not happen for network reasons: Save then
  // keeps the prepared Receipt on the phone and Sync uploads it later.
  const queueable = useRef(false)
  const isPdf = receiptKind(file) === 'pdf'

  const run = useCallback((): Promise<AttachedReceipt | null> => {
    const attempt = (async () => {
      try {
        if (!ready.current) {
          setStage({ kind: 'preparing' })
          ready.current = await readyReceipt(file)
          if (ready.current.prepared.mimeType === 'image/jpeg') setPreview(URL.createObjectURL(ready.current.prepared.blob))
        }
        queueable.current = false
        if (globalThis.navigator?.onLine === false) {
          queueable.current = true
          setStage({ kind: 'offline' })
          return null
        }
        setStage({ kind: 'uploading', fraction: 0 })
        const receipt = await sendReceipt(ready.current, id, initial.expenseDate, {
          onProgress: (fraction) => setStage({ kind: 'uploading', fraction }),
        })
        setStage({ kind: 'attached', receipt })
        return receipt
      } catch (err) {
        queueable.current = ready.current !== null && isTransient(err)
        setStage({ kind: 'failed', message: uploadProblem(err), retryable: !(err instanceof ReceiptRejected) })
        return null
      }
    })()
    pending.current = attempt
    return attempt
  }, [file, id, initial.expenseDate])

  useEffect(() => {
    // Once per picked file, StrictMode's second effect run included.
    if (started.current) return
    started.current = true
    void run()
  }, [run])

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const showPanel = () => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  async function submit(draft: ExpenseDraft, force = false) {
    setBusy(true)
    setError(null)
    setDuplicate(null)
    let receipt: AttachedReceipt | null = null
    // The Receipt could not upload for network reasons: it stays on the
    // phone with the queued Expense and Sync uploads it later (OCR skipped).
    let kept: QueuedReceipt | undefined
    if (stage.kind !== 'removed') {
      receipt = await (pending.current ?? Promise.resolve(null))
      if (!receipt && queueable.current && ready.current) {
        const { prepared, fileHash } = ready.current
        kept = { blob: prepared.blob, mimeType: prepared.mimeType, ext: prepared.ext, fileHash }
      } else if (!receipt) {
        setBusy(false)
        setError('The Receipt has not uploaded. Tap Try again at the top, or Save without it.')
        showPanel()
        return
      }
    }
    try {
      const input = { ...toCreateInput(draft, member.memberId, id), ...(force ? { force: true } : {}) }
      const { expense } = await saveExpense(
        receipt ? { ...input, driveFileId: receipt.fileId, fileHash: receipt.fileHash } : input,
        kept ? { receipt: kept } : {},
      )
      onSaved(expense)
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && err.status === 401) {
        onUnpaired()
        return
      }
      const earlier = duplicateReceiptOf(err)
      if (earlier) {
        setDuplicate({ expense: earlier, draft })
        setError('This receipt was already added. See the message at the top.')
        showPanel()
        return
      }
      setError(
        err instanceof ApiError
          ? `Not saved: ${err.message}`
          : 'Not saved: could not reach the server. Check the connection and tap Save again.',
      )
    }
  }

  const big = 'flex min-w-0 flex-1 items-start gap-3 text-left text-2xl font-semibold leading-snug'

  return (
    <ExpenseForm
      heading="Scan Receipt"
      member={member}
      members={model.members}
      categories={model.categories}
      expenses={model.expenses}
      initial={initial}
      today={today}
      busy={busy}
      error={error}
      onSubmit={(draft) => void submit(draft)}
      onCancel={onCancel}
    >
      <section ref={panel} aria-label="Receipt" aria-live="polite" className="flex scroll-mt-4 flex-col gap-4 rounded-3xl border-4 border-sand bg-warm-white p-5">
        {stage.kind !== 'removed' && (
          <div className="flex items-center gap-4">
            {preview ? (
              <img src={preview} alt="The Receipt" className="size-24 shrink-0 rounded-2xl bg-sand object-cover" />
            ) : (
              <span className="flex size-24 shrink-0 items-center justify-center rounded-2xl bg-sand">
                {isPdf ? <FileText aria-hidden="true" className="size-12" /> : <ImageIcon aria-hidden="true" className="size-12" />}
              </span>
            )}
            <StageText stage={stage} isPdf={isPdf} big={big} />
          </div>
        )}
        {stage.kind === 'uploading' && (
          <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stage.fraction * 100)} className="h-4 overflow-hidden rounded-full bg-sand">
            <div className="h-full bg-olive-sage transition-[width]" style={{ width: `${Math.round(stage.fraction * 100)}%` }} />
          </div>
        )}
        {stage.kind === 'failed' && (
          <div className="flex flex-col gap-3">
            <p className="text-lg">{stage.message} What you typed below is kept.</p>
            {queueable.current && <p className="text-lg">Or tap Save: the Receipt stays on this phone and uploads by itself when the signal is back.</p>}
            {stage.retryable && (
              <Button icon={RefreshCw} onClick={() => void run()} className="w-full">
                Try again
              </Button>
            )}
            <Button icon={X} variant="secondary" onClick={() => setStage({ kind: 'removed' })} className="w-full">
              Save without the Receipt
            </Button>
          </div>
        )}
        {stage.kind === 'removed' && <p className="text-xl font-semibold">No Receipt: this Expense will be saved without one.</p>}
        {duplicate && (
          <div role="alert" className="flex flex-col gap-4 rounded-2xl border-4 border-terracotta p-4">
            <p className={big}>
              <TriangleAlert aria-hidden="true" className="mt-1 size-8 shrink-0 text-terracotta" />
              <span>
                This receipt was already added {onDay(duplicate.expense.expenseDate, today)} for {formatRupees(duplicate.expense.amount)}
              </span>
            </p>
            <Button icon={Check} onClick={() => void submit(duplicate.draft, true)} disabled={busy} className="w-full">
              Add anyway
            </Button>
            <Button icon={X} variant="secondary" onClick={onCancel} disabled={busy} className="w-full">
              Don’t add it
            </Button>
          </div>
        )}
      </section>
    </ExpenseForm>
  )
}

function StageText({ stage, isPdf, big }: { stage: Stage; isPdf: boolean; big: string }) {
  switch (stage.kind) {
    case 'preparing':
      return (
        <p className={big}>
          <CircleDashed aria-hidden="true" className="mt-1 size-8 shrink-0 animate-spin text-brass" />
          {isPdf ? 'Getting the PDF ready…' : 'Shrinking the photo…'}
        </p>
      )
    case 'uploading':
      return (
        <p className={big}>
          <CircleDashed aria-hidden="true" className="mt-1 size-8 shrink-0 animate-spin text-brass" />
          Uploading… {Math.round(stage.fraction * 100)}%
        </p>
      )
    case 'attached':
      return (
        <p className={big}>
          <CircleCheck aria-hidden="true" className="mt-1 size-8 shrink-0 text-olive-sage" />
          Receipt attached
        </p>
      )
    case 'failed':
      return (
        <p role="alert" className={big + ' text-terracotta'}>
          <TriangleAlert aria-hidden="true" className="mt-1 size-8 shrink-0" />
          The Receipt did not upload
        </p>
      )
    case 'offline':
      return (
        <p className={big}>
          <CloudOff aria-hidden="true" className="mt-1 size-8 shrink-0 text-olive-sage" />
          No signal. Tap Save: the Receipt stays on this phone and uploads when online.
        </p>
      )
    case 'removed':
      return null
  }
}

/** `today`, `yesterday`, or `on Thu 29 Oct`, for a sentence. */
function onDay(date: string, today: string): string {
  const label = dayLabel(date, today)
  return /^(Today|Yesterday|Tomorrow)$/.test(label) ? label.toLowerCase() : `on ${label}`
}

/** Words for a failed prepare or upload; never the session URL. */
function uploadProblem(err: unknown): string {
  if (err instanceof ReceiptRejected) return err.message
  if (err instanceof ApiError) {
    if (err.status === 401) return 'This phone needs to be paired again.'
    if (err.code === 'SERVER_MISCONFIGURED') return 'The server is not set up for Receipts yet.'
    return err.message
  }
  if (err instanceof UploadFailed) return 'The connection kept dropping.'
  if (err instanceof Error && /https/.test(err.message)) return err.message
  return 'Something went wrong while preparing the file.'
}
