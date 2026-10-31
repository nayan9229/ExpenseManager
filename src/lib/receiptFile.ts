/**
 * Turning a picked file into a Receipt ready to upload: compress, convert
 * HEIC, and hash. iOS Safari cannot encode WebP
 * (https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob),
 * so every raster Receipt is JPEG.
 *
 * - Photos and PDFs only; anything else is refused with one clear message.
 * - Raster images are shrunk to 1600px on the long edge and encoded as JPEG
 *   at quality 0.82 on every platform (iOS cannot encode WebP; a request for
 *   it silently returns PNG).
 * - HEIC/HEIF (which reaches the page only from the iOS Files app) goes
 *   through a converter that is downloaded only when such a file turns up.
 * - PDFs pass through untouched.
 * - The SHA-256 of the original file is the duplicate check's key.
 */

/** Longest edge of an uploaded photo, in pixels. */
export const MAX_EDGE = 1600
/** JPEG quality for every shrunk photo. */
export const JPEG_QUALITY = 0.82
/** Largest file accepted; `upload-url` and OCR refuse more. */
export const MAX_BYTES = 20 * 1024 * 1024

export type ReceiptKind = 'image' | 'heic' | 'pdf'

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])
const VAGUE_TYPES = new Set(['', 'application/octet-stream'])

/**
 * What kind of Receipt a picked file is, or null for a file the app does
 * not take. The type is checked first; the extension only when the browser
 * gave no useful type (Android sometimes hands HEIC over as octet-stream).
 */
export function receiptKind(file: { type: string; name: string }): ReceiptKind | null {
  const type = file.type.toLowerCase()
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (HEIC_TYPES.has(type)) return 'heic'
  if (type === 'application/pdf') return 'pdf'
  if (type === 'image/svg+xml') return null
  if (type.startsWith('image/')) return 'image'
  if (VAGUE_TYPES.has(type) && file.name.includes('.')) {
    if (ext === 'heic' || ext === 'heif') return 'heic'
    if (ext === 'pdf') return 'pdf'
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image'
  }
  return null
}

/** The file cannot be a Receipt; `message` is what the screen shows. */
export class ReceiptRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReceiptRejected'
  }
}

export const NOT_A_RECEIPT = 'Please choose a photo or PDF'

/** A decoded image the backend can draw. */
export type Decoded = {
  source: unknown
  width: number
  height: number
  /** Frees the decoded pixels (object URL, ImageBitmap). */
  release(): void
}

/** The pixel work, so the browser's canvas and Node's can both do it. */
export type ImageBackend = {
  decode(blob: Blob): Promise<Decoded>
  /** Decodes HEIC/HEIF; the browser backend loads the converter on first use. */
  decodeHeic(blob: Blob): Promise<Decoded>
  encodeJpeg(source: unknown, width: number, height: number, quality: number): Promise<Blob>
}

/** A Receipt ready for `uploadReceipt`. */
export type PreparedReceipt = {
  blob: Blob
  mimeType: 'image/jpeg' | 'application/pdf'
  ext: 'jpg' | 'pdf'
}

/** `width` x `height` scaled down (never up) so the long edge is at most `max`. */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Shrinks a photo to a JPEG, or passes a PDF through. Rejects with a
 * ReceiptRejected carrying the message to show.
 */
export async function prepareReceipt(file: Blob & { name?: string }, backend: ImageBackend = browserBackend): Promise<PreparedReceipt> {
  const kind = receiptKind({ type: file.type, name: file.name ?? '' })
  if (!kind) throw new ReceiptRejected(NOT_A_RECEIPT)
  if (file.size > MAX_BYTES) throw new ReceiptRejected('This file is over 20 MB. Please choose a smaller photo or PDF.')
  if (kind === 'pdf') return { blob: file, mimeType: 'application/pdf', ext: 'pdf' }

  let decoded: Decoded
  try {
    decoded = kind === 'heic' ? await backend.decodeHeic(file) : await backend.decode(file)
  } catch {
    throw new ReceiptRejected(NOT_A_RECEIPT)
  }
  try {
    const size = fitWithin(decoded.width, decoded.height)
    const blob = await backend.encodeJpeg(decoded.source, size.width, size.height, JPEG_QUALITY)
    return { blob, mimeType: 'image/jpeg', ext: 'jpg' }
  } finally {
    decoded.release()
  }
}

/** Hex SHA-256 of the file's bytes. Needs a secure context (https or localhost). */
export async function hashReceipt(file: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('This page must be opened over https to attach a Receipt')
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The browser backend. Decoding goes through an <img>, which applies the
 * photo's EXIF orientation in every current browser, so a phone shot held
 * upright stays upright after the canvas round trip.
 */
export const browserBackend: ImageBackend = {
  async decode(blob) {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    try {
      await img.decode()
    } catch (err) {
      URL.revokeObjectURL(url)
      throw err
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
  },

  async decodeHeic(blob) {
    // The only import of the converter (~3 MB): Vite splits it into its own
    // chunk, fetched the first time a HEIC/HEIF file is picked.
    const { heicTo } = await import('heic-to')
    const bitmap = await heicTo({ blob, type: 'bitmap' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
  },

  encodeJpeg(source, width, height, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return Promise.reject(new Error('No 2D canvas'))
    // JPEG has no transparency: a PNG screenshot's clear pixels become white, not black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height)
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          canvas.width = 0
          canvas.height = 0
          if (blob && blob.type === 'image/jpeg') resolve(blob)
          else reject(new Error('The phone could not encode a JPEG'))
        },
        'image/jpeg',
        quality,
      )
    })
  },
}
