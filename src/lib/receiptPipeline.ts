/**
 * The whole upload-first pipeline for one picked file, as the Scan Receipt
 * screen runs it: hash the original, shrink it (or pass a PDF through),
 * upload it under `<Expense ID>.<ext>`. Saving the Expense with the result
 * renames the file (server side).
 *
 * Ticket 09 (offline): store `prepared.blob`, `prepared.mimeType`,
 * `prepared.ext` and `fileHash` with the queued create, then replay with
 * `uploadReceipt` followed by `createExpense({ ..., driveFileId, fileHash })`.
 */
import { hashReceipt, prepareReceipt, type ImageBackend, type PreparedReceipt } from './receiptFile'
import { uploadReceipt, type UploadDeps, type UploadedReceipt } from './upload'

/** A Receipt that is in Drive and ready to be linked to the Expense. */
export type AttachedReceipt = UploadedReceipt & {
  fileHash: string
  prepared: PreparedReceipt
}

/** The file shrunk and hashed, before any network. */
export type ReadyReceipt = { prepared: PreparedReceipt; fileHash: string }

/** Hashes the original and prepares the upload body, side by side. */
export async function readyReceipt(file: File, backend?: ImageBackend): Promise<ReadyReceipt> {
  const [fileHash, prepared] = await Promise.all([hashReceipt(file), prepareReceipt(file, backend)])
  return { prepared, fileHash }
}

/** Uploads a ready Receipt for Expense `expenseId`, dated `expenseDate` (picks the month folder). */
export async function sendReceipt(ready: ReadyReceipt, expenseId: string, expenseDate: string, deps?: UploadDeps): Promise<AttachedReceipt> {
  const uploaded = await uploadReceipt(
    { blob: ready.prepared.blob, name: `${expenseId}.${ready.prepared.ext}`, mimeType: ready.prepared.mimeType, expenseDate },
    deps,
  )
  return { ...uploaded, fileHash: ready.fileHash, prepared: ready.prepared }
}
