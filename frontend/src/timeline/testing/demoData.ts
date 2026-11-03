// Synthetic timeline data for tests, visual checks and demos (no runtime imports, so plain Node can
// load this file too). Deterministic: the same seed always yields the same dataset.
import type { AppearanceOut, CategoryOut, ChildOut, TimelineEventOut, TimelineOut } from '../../api/schema.gen'

export const DEMO_CATEGORIES: CategoryOut[] = [
  { id: 1, key: 'general', name_es: 'General', name_en: 'General', name_pt: 'Geral', icon: 'star', color: '#64748b', sort_order: 0 },
  { id: 2, key: 'academic', name_es: 'Académico', name_en: 'Academic', name_pt: 'Académico', icon: 'school', color: '#4f46e5', sort_order: 1 },
  { id: 3, key: 'teething', name_es: 'Dentición', name_en: 'Teething', name_pt: 'Dentição', icon: 'dental', color: '#14b8a6', sort_order: 2 },
  { id: 4, key: 'language', name_es: 'Lenguaje y comunicación', name_en: 'Language & communication', name_pt: 'Linguagem e comunicação', icon: 'message-circle', color: '#f59e0b', sort_order: 3 },
  { id: 5, key: 'sleep', name_es: 'Sueño', name_en: 'Sleep', name_pt: 'Sono', icon: 'moon', color: '#8b5cf6', sort_order: 4 },
  { id: 6, key: 'gross-motor', name_es: 'Motricidad gruesa', name_en: 'Gross motor skills', name_pt: 'Motricidade global', icon: 'walk', color: '#ef4444', sort_order: 5 },
  { id: 7, key: 'fine-motor', name_es: 'Motricidad fina', name_en: 'Fine motor skills', name_pt: 'Motricidade fina', icon: 'hand-finger', color: '#f97316', sort_order: 6 },
  { id: 8, key: 'cognitive', name_es: 'Desarrollo cognitivo', name_en: 'Cognitive development', name_pt: 'Desenvolvimento cognitivo', icon: 'brain', color: '#3b82f6', sort_order: 7 },
  { id: 9, key: 'social-emotional', name_es: 'Desarrollo social y emocional', name_en: 'Social & emotional development', name_pt: 'Desenvolvimento social e emocional', icon: 'heart-handshake', color: '#ec4899', sort_order: 8 },
  { id: 10, key: 'feeding', name_es: 'Alimentación', name_en: 'Feeding', name_pt: 'Alimentação', icon: 'baby-bottle', color: '#22c55e', sort_order: 9 },
  { id: 11, key: 'self-care', name_es: 'Autonomía y cuidado personal', name_en: 'Independence & self-care', name_pt: 'Autonomia e cuidados pessoais', icon: 'shirt', color: '#06b6d4', sort_order: 10 },
]

export const DEMO_CHILDREN: ChildOut[] = [
  { id: 1, name: 'Ana', slug: 'ana', birth_date: '2024-02-02', avatar: null, color: null, sort_order: 0 },
  { id: 2, name: 'Leo', slug: 'leo', birth_date: '2026-01-15', avatar: null, color: null, sort_order: 1 },
]

export const DEMO_APPEARANCE: AppearanceOut = {
  year_colors: [],
  event_years: [2026, 2025, 2024],
  background: null,
  background_opacity: 0.18,
  default_zoom: 'events',
  direction_desktop: 'right_to_left',
  direction_mobile: 'bottom_to_top',
}

const TITLES: ReadonlyArray<readonly [string, number[]]> = [
  ['Primera sonrisa', [9, 4]],
  ['Primeros pasos sin ayuda por el pasillo de casa', [6]],
  ['Primer diente', [3]],
  ['Dice «mamá» por primera vez', [4, 9]],
  ['Duerme toda la noche del tirón', [5]],
  ['Primera papilla de frutas', [10]],
  ['Se sienta sin apoyo', [6]],
  ['Gatea por todo el salón persiguiendo al gato', [6, 8]],
  ['Primer día en la escuela infantil', [2, 9]],
  ['Aplaude al ritmo de la música', [7, 4]],
  ['Reconoce su nombre', [8, 4]],
  ['Primer viaje a la playa con los abuelos y los primos en Cádiz durante las vacaciones de verano', [1, 9]],
  ['Se ríe a carcajadas con las pompas de jabón', [9]],
  ['Come sola con cuchara', [10, 11, 7]],
  ['Construye una torre de cinco bloques', [7, 8]],
  ['Primer corte de pelo', [1]],
  ['Señala los animales del cuento', [8, 4]],
  ['Sube las escaleras gateando', [6]],
  ['Bebe del vaso sin derramar', [10, 11]],
  ['Canta su primera canción entera', [4]],
  ['Siesta larga en el parque', [5]],
  ['Se pone los zapatos sola', [11, 7]],
  ['Dibuja un círculo', [7, 2]],
  ['Primera excursión al zoo', [1, 8, 9]],
  ['Cuenta hasta diez', [2, 8]],
  ['Duerme en su habitación nueva', [5, 11]],
  ['Salta con los dos pies', [6]],
  ['Comparte sus juguetes con su prima', [9]],
  ['Muelas nuevas', [3]],
  ['Primera bicicleta sin pedales', [6, 1]],
  ['Lava sus manos sin ayuda', [11]],
  ['Frase de tres palabras', [4, 8]],
]

/** Events per month from February 2024 to October 2026: deliberately uneven (gaps and busy months). */
const MONTH_COUNTS = [2, 1, 3, 0, 5, 2, 1, 4, 0, 2, 6, 3, 2, 1, 0, 4, 7, 2, 3, 0, 1, 5, 2, 3, 9, 4, 2, 6, 3, 1, 0, 5, 4]

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SWATCHES = ['#d9a066', '#8fb3d9', '#c98b9c', '#9cc59a', '#e2c27a', '#a48fd1', '#e59b7a', '#7fb8b0', '#d6b4a0', '#b7c46f']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function uuid(random: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export interface DemoTimelineOptions {
  childId?: number
  seed?: number
}

/** ≈ 90 events between 2024 and 2026 (newest first): same-day pairs, 1–3 categories, some without photos. */
export function demoEvents({ childId = 1, seed = 7 }: DemoTimelineOptions = {}): TimelineEventOut[] {
  const random = mulberry32(seed)
  const events: TimelineEventOut[] = []
  let id = 1
  MONTH_COUNTS.forEach((count, offset) => {
    const year = 2024 + Math.floor((offset + 1) / 12)
    const month = ((offset + 1) % 12) + 1
    const days = new Date(year, month, 0).getDate()
    let day = 1 + Math.floor(random() * 4)
    for (let index = 0; index < count; index += 1) {
      // Every few events share the previous one's day.
      if (index > 0 && random() > 0.3) day = Math.min(days, day + 1 + Math.floor(random() * Math.max(1, (days - day) / (count - index))))
      const [title, categoryIds] = TITLES[(id * 7 + offset) % TITLES.length]
      const extra = random() > 0.82 ? [1 + Math.floor(random() * 11)] : []
      const categories = [...new Set([...categoryIds, ...extra])].slice(0, 3)
      const withPhoto = random() > 0.18
      const date = `${year}-${pad(month)}-${pad(day)}`
      events.push({
        id,
        title,
        date,
        day_order: 0,
        category_ids: categories,
        child_ids: [childId],
        cover: withPhoto ? { id: uuid(random), thumb_url: '', dominant_color: SWATCHES[id % SWATCHES.length] } : null,
        image_count: withPhoto ? 1 + Math.floor(random() * 6) : 0,
        created_at: `${date}T${pad(8 + (index % 12))}:${pad((id * 13) % 60)}:00Z`,
      })
      id += 1
    }
  })
  for (const event of events) {
    if (event.cover) event.cover.thumb_url = `/api/media/${event.cover.id}/thumb`
  }
  // A milestone with many categories exercises the "+N" badge.
  const busy = events.find((event) => event.date.startsWith('2026-03'))
  if (busy) busy.category_ids = [6, 4, 9, 8, 10]
  return events.toSorted((a, b) => (a.date === b.date ? b.created_at.localeCompare(a.created_at) || b.id - a.id : a.date < b.date ? 1 : -1))
}

export function demoTimeline(options: DemoTimelineOptions = {}): TimelineOut {
  const events = demoEvents(options)
  return { child_id: options.childId ?? 1, total: events.length, events }
}
