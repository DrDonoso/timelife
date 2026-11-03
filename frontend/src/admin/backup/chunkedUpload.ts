import { ApiError, api, isAbortError, isApiError } from '../../api/client'
import type { ImportOut } from '../../api/schema.gen'
import { busyRetryDelay, sleep } from '../events/uploadQueue'
import { fetchImport, IMPORTS_URL } from './backupApi'

/** Cuts, timeouts and busy or failing servers are retried this many times in a row. */
export const MAX_PIECE_RETRIES = 8

/** Sends `piece` (the bytes of the file from `offset`) and answers the updated session. */
export type PieceSender = (
  session: ImportOut,
  offset: number,
  piece: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
) => Promise<ImportOut>

export interface ArchiveUploadOptions {
  file: Blob
  /** An "uploading" session for `file` (new, or left half-way). */
  session: ImportOut
  /** Bytes of the file the server has, plus those of the piece on its way. */
  onProgress: (sent: number) => void
  signal: AbortSignal
  send?: PieceSender
  refresh?: (id: string, signal: AbortSignal) => Promise<ImportOut>
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
  maxRetries?: number
}

export const sendPiece: PieceSender = (session, offset, piece, onProgress, signal) =>
  api.putBinary<ImportOut>(`${IMPORTS_URL}/${session.id}/content`, piece, {
    params: { offset },
    signal,
    onProgress: (loaded) => onProgress(loaded),
  })

/** Cut connections, timeouts and 5xx answers (but a full disk) are worth another try. */
function retryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.status === 0 || error.status === 408 || (error.status >= 500 && error.status !== 507)
}

/**
 * Sends the rest of `file`, one `chunk_size` piece at a time from what the server already has
 * (`received`), and returns the session once every byte arrived ("ready" or "invalid"). After a
 * cut it waits, asks the server how much arrived and goes on from there; a 413 (a proxy refusing
 * the pieces) becomes `import_chunk_too_large`.
 */
export async function uploadArchive({
  file,
  session,
  onProgress,
  signal,
  send = sendPiece,
  refresh = fetchImport,
  wait = sleep,
  maxRetries = MAX_PIECE_RETRIES,
}: ArchiveUploadOptions): Promise<ImportOut> {
  let current = session
  let failures = 0
  onProgress(current.received)
  while (current.status === 'uploading' && current.received < current.size) {
    const offset = current.received
    const piece = file.slice(offset, Math.min(offset + current.chunk_size, current.size))
    try {
      current = await send(current, offset, piece, (loaded) => onProgress(offset + Math.min(loaded, piece.size)), signal)
      failures = 0
      onProgress(current.received)
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error
      if (isApiError(error, 'import_offset_mismatch')) {
        const received = error.detail?.received
        if (typeof received !== 'number' || failures >= maxRetries) throw error
        failures += 1
        current = { ...current, received }
        continue
      }
      if (error instanceof ApiError && error.status === 413) {
        throw new ApiError({ status: 413, code: 'import_chunk_too_large' })
      }
      if (!retryable(error) || failures >= maxRetries) throw error
      failures += 1
      await wait(busyRetryDelay(error, failures), signal)
      try {
        current = await refresh(current.id, signal)
      } catch (caught) {
        if (isAbortError(caught) || signal.aborted) throw caught
      }
    }
  }
  return current
}

/** A file name as the server keeps it (NFC, whitespace collapsed). */
function cleanName(name: string): string {
  return name.normalize('NFC').split(/\s+/).filter(Boolean).join(' ')
}

/** Whether `file` is the one a session was opened for (name, size and date). */
export function isSameFile(session: ImportOut, file: File): boolean {
  return (
    cleanName(session.filename) === cleanName(file.name) &&
    session.size === file.size &&
    (session.last_modified === null || session.last_modified === file.lastModified)
  )
}
