import type { CategoryOut } from '../api/schema.gen'
import type { Lang } from '../i18n/types'

/** A category's names (`name_pt` is optional so ad-hoc objects, e.g. chip options, can omit it). */
type NamedCategory = Pick<CategoryOut, 'name_es' | 'name_en'> & Partial<Pick<CategoryOut, 'name_pt'>>

/** What visual category components need (a full `CategoryOut` works, and so do draft values). */
export type CategoryLike = Pick<CategoryOut, 'color' | 'icon'> & NamedCategory & { id?: number }

/** Names tried for each UI language: its own, then Spanish (the source language), English and Portuguese. */
const NAME_ORDER: Readonly<Record<Lang, readonly (keyof NamedCategory)[]>> = {
  es: ['name_es', 'name_en', 'name_pt'],
  en: ['name_en', 'name_es', 'name_pt'],
  pt: ['name_pt', 'name_es', 'name_en'],
}

/** Category name in the UI language (empty or missing names fall back to the other languages). */
export function categoryName(category: NamedCategory, lang: Lang): string {
  for (const field of NAME_ORDER[lang]) {
    const name = category[field]?.trim()
    if (name) return name
  }
  return ''
}

export function categoriesById(categories: readonly CategoryOut[] | null | undefined): Map<number, CategoryOut> {
  return new Map((categories ?? []).map((category) => [category.id, category]))
}

/** Categories for `ids` in that order (event order = ring order); unknown ids are skipped. */
export function pickCategories(
  ids: readonly number[],
  byId: ReadonlyMap<number, CategoryOut>,
): CategoryOut[] {
  return ids.flatMap((id) => {
    const category = byId.get(id)
    return category ? [category] : []
  })
}
