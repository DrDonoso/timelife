import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { invalidateEventQueries, qk, type AdminEventsParams } from '../../api/queries'
import type { EventIn, EventOut, EventPageOut, EventSummaryOut, EventUpdateIn, LocationOut, TrashItemOut, UploadOut } from '../../api/schema.gen'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage } from '../../i18n'
import type { OrderStatus } from '../categories/useOrderSaver'
import { applyDayOrder } from './dayOrder'
import type { UploadRequest } from './uploadQueue'

/** Rows per page in the admin events list. */
export const EVENTS_PAGE_SIZE = 20

/** `GET /api/admin/events` (non-deleted, newest first); keeps the previous page while loading. */
export function useAdminEvents(params: AdminEventsParams) {
  return useQuery({
    queryKey: qk.adminEvents(params),
    queryFn: ({ signal }) =>
      api.get<EventPageOut>('/api/admin/events', {
        params: {
          q: params.q?.trim(),
          child_id: params.childId,
          category_id: params.categoryId,
          date_from: params.from,
          date_to: params.to,
          page: params.page,
          page_size: params.pageSize,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  })
}

/** `GET /api/admin/events/{id}` (also returns trashed events). Always refreshed when an editor opens. */
export function useAdminEvent(id: number | undefined) {
  return useQuery({
    queryKey: qk.adminEvent(id ?? 0),
    queryFn: ({ signal }) => api.get<EventOut>(`/api/admin/events/${id}`, { signal }),
    enabled: id !== undefined,
    refetchOnMount: 'always',
    // The editor seeds its form once; background refreshes must not look like new data to edit.
    refetchOnWindowFocus: false,
  })
}

/** `GET /api/admin/locations`: places already used, the most used first (location suggestions). */
export function useLocations() {
  return useQuery({
    queryKey: qk.locations,
    queryFn: ({ signal }) => api.get<LocationOut[]>('/api/admin/locations', { signal }),
  })
}

export function useTrash() {
  return useQuery({
    queryKey: qk.trash,
    queryFn: ({ signal }) => api.get<TrashItemOut[]>('/api/admin/trash', { signal }),
  })
}

/** Create (`POST`) or update (`PUT`, with `version`) an event; refreshes every view of events. */
export function useSaveEvent(eventId: number | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload: EventIn | EventUpdateIn) =>
      eventId === undefined
        ? api.post<EventOut>('/api/admin/events', payload)
        : api.put<EventOut>(`/api/admin/events/${eventId}`, payload),
    onSuccess: (event) => {
      client.setQueryData(qk.adminEvent(event.id), event)
      void invalidateEventQueries(client, event.id)
    },
  })
}

/** Soft delete (moves the event to the trash). */
export function useDeleteEvent() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/events/${id}`),
    onSettled: (_data, _error, id) => invalidateEventQueries(client, id),
  })
}

export function useRestoreEvent() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<EventOut>(`/api/admin/trash/${id}/restore`),
    onSettled: (_data, _error, id) => invalidateEventQueries(client, id),
  })
}

/** Permanent delete (rows + image files) of a trashed event. */
export function usePurgeEvent() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/trash/${id}`),
    onSettled: (_data, _error, id) => invalidateEventQueries(client, id),
  })
}

const SAVED_VISIBLE_MS = 2500

function refreshOrderedViews(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['admin', 'events'] }),
    client.invalidateQueries({ queryKey: ['timeline'] }),
  ]).then(() => undefined)
}

/**
 * Order of the events of one day in the admin list (`PUT /api/admin/events/day-order`). The list
 * of `params` updates at once; requests run one at a time and only the latest order of each day is
 * sent after the one in flight. On failure the error is shown and the lists are refetched.
 */
export function useDayOrder(params: AdminEventsParams) {
  const client = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const [status, setStatus] = useState<OrderStatus>('idle')
  const queued = useRef(new Map<string, number[]>())
  const running = useRef(false)
  const savedTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(savedTimer.current), [])

  async function flush() {
    running.current = true
    window.clearTimeout(savedTimer.current)
    setStatus('saving')
    try {
      for (let next = queued.current.entries().next(); !next.done; next = queued.current.entries().next()) {
        const [date, ids] = next.value
        queued.current.delete(date)
        await api.put<EventSummaryOut[]>('/api/admin/events/day-order', { date, ids })
      }
      setStatus('saved')
      savedTimer.current = window.setTimeout(
        () => setStatus((current) => (current === 'saved' ? 'idle' : current)),
        SAVED_VISIBLE_MS,
      )
    } catch (error) {
      queued.current.clear()
      setStatus('error')
      show({ tone: 'error', message: errorMessage(error) })
    } finally {
      running.current = false
      void refreshOrderedViews(client)
    }
  }

  function reorder(date: string, ids: number[]) {
    void client.cancelQueries({ queryKey: ['admin', 'events'] })
    client.setQueryData<EventPageOut>(qk.adminEvents(params), (page) =>
      page ? { ...page, items: applyDayOrder(page.items, date, ids) } : page,
    )
    queued.current.set(date, ids)
    if (!running.current) void flush()
  }

  return { reorder, status }
}

/**
 * `POST /api/admin/uploads?purpose=event` with progress: a photo, a video or a Live Photo (the photo
 * plus its clip as `motion`). It stays pending until the event is saved; a video's MP4 is converted
 * afterwards (`video_status: 'processing'`, see {@link fetchUpload}).
 */
export function uploadEventImage(file: File, { onProgress, signal, motion }: UploadRequest): Promise<UploadOut> {
  return api.upload<UploadOut>('/api/admin/uploads', file, {
    params: { purpose: 'event' },
    extraFiles: motion ? { motion } : undefined,
    onProgress: (fraction) => onProgress(fraction),
    signal,
  })
}

/** `GET /api/admin/uploads/{id}`: an upload (or saved image) while its video is being converted. */
export function fetchUpload(id: string, signal?: AbortSignal): Promise<UploadOut> {
  return api.get<UploadOut>(`/api/admin/uploads/${encodeURIComponent(id)}`, { signal })
}
