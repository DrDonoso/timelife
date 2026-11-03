import { describe, expect, it } from 'vitest'
import type { CategoryOut } from '../api/schema.gen'
import { categoriesById, categoryName, pickCategories } from './categories'

const SLEEP: CategoryOut = { id: 2, key: 'sleep', name_es: 'Sueño', name_en: 'Sleep', name_pt: 'Sono', icon: 'moon', color: '#8b5cf6', sort_order: 1 }
const FEEDING: CategoryOut = { id: 3, key: 'feeding', name_es: 'Alimentación', name_en: 'Feeding', name_pt: 'Alimentação', icon: 'baby-bottle', color: '#22c55e', sort_order: 2 }

describe('categoryName', () => {
  it('uses the name in the UI language (trimmed)', () => {
    expect(categoryName(SLEEP, 'es')).toBe('Sueño')
    expect(categoryName(SLEEP, 'en')).toBe('Sleep')
    expect(categoryName(SLEEP, 'pt')).toBe('Sono')
    expect(categoryName({ name_es: ' Baño ', name_en: ' Bath ', name_pt: ' Banho ' }, 'pt')).toBe('Banho')
  })

  it('falls back from Portuguese to Spanish, then English', () => {
    expect(categoryName({ ...SLEEP, name_pt: '' }, 'pt')).toBe('Sueño')
    expect(categoryName({ ...SLEEP, name_pt: '   ', name_es: '' }, 'pt')).toBe('Sleep')
  })

  it('falls back between Spanish and English when a name is blank', () => {
    expect(categoryName({ ...SLEEP, name_es: '  ' }, 'es')).toBe('Sleep')
    expect(categoryName({ ...SLEEP, name_en: '' }, 'en')).toBe('Sueño')
    // Portuguese is the last resort.
    expect(categoryName({ ...SLEEP, name_es: '', name_en: ' ' }, 'es')).toBe('Sono')
    expect(categoryName({ ...SLEEP, name_es: '', name_en: '' }, 'en')).toBe('Sono')
  })

  it('accepts objects without a Portuguese name', () => {
    const option = { name_es: 'Sueño', name_en: 'Sleep' }
    expect(categoryName(option, 'pt')).toBe('Sueño')
    expect(categoryName({ ...option, name_es: '' }, 'pt')).toBe('Sleep')
    expect(categoryName(option, 'en')).toBe('Sleep')
  })

  it('is empty only when every name is', () => {
    expect(categoryName({ name_es: '', name_en: ' ', name_pt: '' }, 'pt')).toBe('')
    expect(categoryName({ name_es: '', name_en: '' }, 'es')).toBe('')
  })
})

describe('categoriesById / pickCategories', () => {
  it('picks categories in the order of the ids, skipping unknown ones', () => {
    const byId = categoriesById([SLEEP, FEEDING])
    expect(byId.get(3)).toBe(FEEDING)
    expect(pickCategories([3, 99, 2], byId)).toEqual([FEEDING, SLEEP])
    expect(categoriesById(undefined).size).toBe(0)
    expect(categoriesById(null).size).toBe(0)
  })
})
