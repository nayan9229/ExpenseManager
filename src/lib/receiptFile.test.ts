import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, test } from 'vitest'
import { hashReceipt, prepareReceipt, receiptKind, ReceiptRejected, type ImageBackend } from './receiptFile'

/**
 * A canvas backend for Node: the same decode → draw → encode the browser
 * does, through @napi-rs/canvas (Skia), so the smoke test checks real JPEG
 * bytes rather than a stub's say-so.
 */
function nodeBackend(heic?: (blob: Blob) => Promise<Blob>): ImageBackend & { heicCalls: number } {
  const backend = {
    heicCalls: 0,
    async decode(blob: Blob) {
      try {
        const image = await loadImage(new Uint8Array(await blob.arrayBuffer()))
        return { source: image, width: image.width, height: image.height, release() {} }
      } catch {
        throw new Error('undecodable')
      }
    },
    async decodeHeic(blob: Blob) {
      backend.heicCalls++
      if (!heic) throw new Error('no HEIC converter in this test')
      return backend.decode(await heic(blob))
    },
    async encodeJpeg(source: unknown, width: number, height: number, quality: number) {
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(source as Parameters<typeof ctx.drawImage>[0], 0, 0, width, height)
      const bytes = await canvas.encode('jpeg', Math.round(quality * 100))
      return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
    },
  }
  return backend
}

/** A PNG photo of the given size, as a picked File. */
async function png(width: number, height: number, name = 'photo.png'): Promise<File> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#A9603F'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#4A3728'
  ctx.fillRect(0, 0, width / 2, height / 2)
  return new File([new Uint8Array(await canvas.encode('png'))], name, { type: 'image/png' })
}

/** Width and height from a JPEG's SOF marker, read straight from the bytes. */
async function jpegSize(blob: Blob): Promise<{ width: number; height: number }> {
  const b = new Uint8Array(await blob.arrayBuffer())
  expect([b[0], b[1]]).toEqual([0xff, 0xd8]) // SOI: it really is a JPEG
  let i = 2
  while (i < b.length) {
    const marker = b[i + 1]!
    const length = (b[i + 2]! << 8) | b[i + 3]!
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! }
    }
    i += 2 + length
  }
  throw new Error('no SOF marker')
}

describe('prepareReceipt (compression smoke test)', () => {
  test('a large landscape photo becomes a JPEG 1600px on the long edge', async () => {
    const prepared = await prepareReceipt(await png(4000, 3000), nodeBackend())

    expect(prepared.mimeType).toBe('image/jpeg')
    expect(prepared.blob.type).toBe('image/jpeg')
    expect(prepared.ext).toBe('jpg')
    expect(await jpegSize(prepared.blob)).toEqual({ width: 1600, height: 1200 })
  })

  test('a portrait photo is limited by its height', async () => {
    const prepared = await prepareReceipt(await png(1500, 4500), nodeBackend())

    expect(await jpegSize(prepared.blob)).toEqual({ width: 533, height: 1600 })
  })

  test('a small image is re-encoded as JPEG but never enlarged', async () => {
    const prepared = await prepareReceipt(await png(800, 600), nodeBackend())

    expect(prepared.mimeType).toBe('image/jpeg')
    expect(await jpegSize(prepared.blob)).toEqual({ width: 800, height: 600 })
  })

  test('a PDF passes through untouched', async () => {
    const pdf = new File(['%PDF-1.7\n1 0 obj\n'], 'electricity-bill.pdf', { type: 'application/pdf' })
    const backend = nodeBackend()

    const prepared = await prepareReceipt(pdf, backend)

    expect(prepared.blob).toBe(pdf)
    expect(prepared).toMatchObject({ mimeType: 'application/pdf', ext: 'pdf' })
  })

  test('HEIC goes through the converter, and only HEIC does', async () => {
    const converted = await png(3024, 4032)
    const backend = nodeBackend(async () => converted)

    await prepareReceipt(await png(2000, 1000), backend)
    expect(backend.heicCalls).toBe(0)

    const heic = new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], 'IMG_0001.HEIC', { type: 'image/heic' })
    const prepared = await prepareReceipt(heic, backend)

    expect(backend.heicCalls).toBe(1)
    expect(prepared.mimeType).toBe('image/jpeg')
    expect(await jpegSize(prepared.blob)).toEqual({ width: 1200, height: 1600 })
  })

  test('an image the phone cannot decode is refused with the photo-or-PDF message', async () => {
    const broken = new File(['not really a jpeg'], 'photo.jpg', { type: 'image/jpeg' })

    const result = prepareReceipt(broken, nodeBackend())

    await expect(result).rejects.toBeInstanceOf(ReceiptRejected)
    await expect(result).rejects.toThrow('Please choose a photo or PDF')
  })

  test('other types are refused before anything is decoded', async () => {
    const result = prepareReceipt(new File(['a,b'], 'export.csv', { type: 'text/csv' }), nodeBackend())

    await expect(result).rejects.toThrow('Please choose a photo or PDF')
  })

  test('a PDF over 20 MB is refused', async () => {
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'scan.pdf', { type: 'application/pdf' })

    await expect(prepareReceipt(big, nodeBackend())).rejects.toThrow(/20 MB/)
  })
})

describe('receiptKind', () => {
  test.each([
    ['image/jpeg', 'IMG_1.jpg', 'image'],
    ['image/png', 'shot.png', 'image'],
    ['image/webp', 'x.webp', 'image'],
    ['image/heic', 'IMG_2.HEIC', 'heic'],
    ['image/heif', 'IMG_3.heif', 'heic'],
    ['', 'IMG_4.heic', 'heic'],
    ['application/octet-stream', 'IMG_5.HEIF', 'heic'],
    ['application/pdf', 'bill.pdf', 'pdf'],
    ['', 'bill.PDF', 'pdf'],
    ['text/csv', 'export.csv', null],
    ['image/svg+xml', 'logo.svg', null],
    ['video/mp4', 'clip.mp4', null],
    ['', 'mystery', null],
  ])('%s %s is %s', (type, name, kind) => {
    expect(receiptKind({ type, name })).toBe(kind)
  })
})

describe('hashReceipt', () => {
  test('is the hex SHA-256 of the original bytes', async () => {
    // printf 'test' | shasum -a 256
    expect(await hashReceipt(new Blob(['test']))).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
  })
})
