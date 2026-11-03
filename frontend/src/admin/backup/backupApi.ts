import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { BackupSummaryOut, ImportCreateIn, ImportOut, ImportStartIn } from '../../api/schema.gen'

export const EXPORT_URL = '/api/admin/backup/export'
export const IMPORTS_URL = '/api/admin/backup/imports'

export type ImportMode = ImportStartIn['mode']

export const backupKeys = {
  summary: ['admin', 'backup', 'summary'] as const,
  imports: ['admin', 'backup', 'imports'] as const,
}

/** While an import runs, its session is fetched again this often. */
export const IMPORT_REFRESH_MS = 1000

/** What an export holds now (`GET /api/admin/backup/summary`). */
export function useBackupSummary() {
  return useQuery({
    queryKey: backupKeys.summary,
    queryFn: ({ signal }) => api.get<BackupSummaryOut>('/api/admin/backup/summary', { signal }),
  })
}

/** The import session (there is at most one), polled while it runs. */
export function useImportSession() {
  return useQuery({
    queryKey: backupKeys.imports,
    queryFn: ({ signal }) => api.get<ImportOut[]>(IMPORTS_URL, { signal }),
    select: (sessions): ImportOut | null => sessions[0] ?? null,
    refetchInterval: (query) => (query.state.data?.[0]?.status === 'running' ? IMPORT_REFRESH_MS : false),
  })
}

export function fetchImport(id: string, signal?: AbortSignal): Promise<ImportOut> {
  return api.get<ImportOut>(`${IMPORTS_URL}/${id}`, { signal })
}

/** Writes a session answered by the API into the cache (null: no session any more). */
export function useSetImport() {
  const client = useQueryClient()
  return (session: ImportOut | null) => {
    client.setQueryData<ImportOut[]>(backupKeys.imports, session ? [session] : [])
  }
}

export function useCreateImport() {
  const setImport = useSetImport()
  return useMutation({
    mutationFn: (body: ImportCreateIn) => api.post<ImportOut>(IMPORTS_URL, body),
    onSuccess: setImport,
  })
}

export function useStartImport() {
  const setImport = useSetImport()
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: ImportMode }) =>
      api.post<ImportOut>(`${IMPORTS_URL}/${id}/start`, { mode } satisfies ImportStartIn),
    onSuccess: setImport,
  })
}

export function useCancelImport() {
  const setImport = useSetImport()
  return useMutation({
    mutationFn: (id: string) => api.post<ImportOut>(`${IMPORTS_URL}/${id}/cancel`),
    onSuccess: setImport,
  })
}

export function useDiscardImport() {
  const setImport = useSetImport()
  return useMutation({
    mutationFn: (id: string) => api.del(`${IMPORTS_URL}/${id}`),
    onSuccess: () => setImport(null),
  })
}
