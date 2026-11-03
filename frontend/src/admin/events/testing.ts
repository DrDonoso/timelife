// Fixtures shared by the admin events / trash tests (imported from *.test.tsx files only).
import type { EventOut, EventPageOut, EventSummaryOut, ImageOut, TrashItemOut } from '../../api/schema.gen'

export function imageOut(id: string, name = id): ImageOut {
  return {
    id,
    name,
    kind: 'image',
    width: 1600,
    height: 1200,
    dominant_color: '#c8a27a',
    crop: null,
    thumb_url: `/api/media/${id}/thumb`,
    display_url: `/api/media/${id}/display`,
    video_status: null,
    video_url: null,
    duration: null,
    live: false,
  }
}

/** A video (or, with `video_status` on a photo, a Live Photo) as the API describes it. */
export function videoOut(id: string, name = id, overrides: Partial<ImageOut> = {}): ImageOut {
  return {
    ...imageOut(id, name),
    kind: 'video',
    video_status: 'ready',
    video_url: `/api/media/${id}/video`,
    duration: 42,
    ...overrides,
  }
}

export function eventOut(overrides: Partial<EventOut> = {}): EventOut {
  return {
    id: 7,
    title: 'Primeros pasos',
    date: '2026-03-12',
    notes: 'Tres pasos seguidos hasta el sofá.',
    location: 'Casa',
    child_ids: [1],
    category_ids: [2, 1],
    images: [imageOut('11111111-1111-4111-8111-111111111111', 'Salón'), imageOut('22222222-2222-4222-8222-222222222222', 'Sofá')],
    cover_image_id: '22222222-2222-4222-8222-222222222222',
    version: 3,
    created_at: '2026-03-12T10:00:00Z',
    updated_at: '2026-03-12T10:00:00Z',
    deleted_at: null,
    ...overrides,
  }
}

export function summary(id: number, overrides: Partial<EventSummaryOut> = {}): EventSummaryOut {
  return {
    id,
    title: `Evento ${id}`,
    date: '2026-03-12',
    location: null,
    child_ids: [1],
    category_ids: [1],
    cover: null,
    image_count: 0,
    video_count: 0,
    updated_at: '2026-03-12T10:00:00Z',
    ...overrides,
  }
}

export function eventPage(items: EventSummaryOut[], { total = items.length, page = 1, pageSize = 20 } = {}): EventPageOut {
  return { items, total, page, page_size: pageSize }
}

export function trashItem(id: number, overrides: Partial<TrashItemOut> = {}): TrashItemOut {
  return {
    id,
    title: `Borrado ${id}`,
    date: '2025-11-02',
    child_ids: [1],
    category_ids: [3],
    cover: null,
    image_count: 0,
    video_count: 0,
    deleted_at: '2026-04-01T09:30:00Z',
    deleted_by: 'Ada Admin',
    ...overrides,
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
