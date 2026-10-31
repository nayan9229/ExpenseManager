import { FileText, ReceiptText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getThumbnail } from '../lib/receipts'

type Thumb = { state: 'loading' } | { state: 'ready'; url: string; isPdf: boolean } | { state: 'none' }

/**
 * The object URL of a Receipt's thumbnail, from the Dexie cache or the
 * `receipt` function; revoked when the component goes. `none` covers "Drive
 * has not made one yet" and "offline with nothing cached" alike: the row
 * still shows a Receipt icon to tap.
 */
export function useThumbnail(fileId: string): Thumb {
  const [thumb, setThumb] = useState<Thumb>({ state: 'loading' })
  useEffect(() => {
    let url: string | null = null
    let live = true
    setThumb({ state: 'loading' })
    getThumbnail(fileId)
      .then((row) => {
        if (!live) return
        if (!row) return setThumb({ state: 'none' })
        url = URL.createObjectURL(row.blob)
        setThumb({ state: 'ready', url, isPdf: row.receiptType === 'application/pdf' })
      })
      .catch(() => live && setThumb({ state: 'none' }))
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [fileId])
  return thumb
}

/** An 80px tappable Receipt thumbnail for the last-five list. */
export function ReceiptThumb({ fileId, label, onOpen }: { fileId: string; label: string; onOpen: () => void }) {
  const thumb = useThumbnail(fileId)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={
        'relative flex w-20 min-h-touch shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-sand ' +
        'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage active:scale-[0.98] transition-transform'
      }
    >
      {thumb.state === 'ready' ? (
        <>
          <img src={thumb.url} alt="" className="absolute inset-0 size-full object-cover" />
          {thumb.isPdf && (
            <span className="absolute bottom-1 left-1 rounded-md bg-mocha px-1 text-base leading-tight font-bold text-warm-white">PDF</span>
          )}
        </>
      ) : thumb.state === 'loading' ? (
        <ReceiptText aria-hidden="true" className="size-8 animate-pulse" />
      ) : (
        <FileText aria-hidden="true" className="size-8" />
      )}
    </button>
  )
}
