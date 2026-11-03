import { describe, expect, it } from 'vitest'
import { translate, type TranslationKey, type TranslationParams } from '../i18n'
import { mediaCount } from './mediaCount'

const es = (key: TranslationKey, params?: TranslationParams) => translate('es', key, params)
const en = (key: TranslationKey, params?: TranslationParams) => translate('en', key, params)

describe('mediaCount', () => {
  it('counts photos and videos separately', () => {
    expect(mediaCount(es, 0, 0)).toBe('Sin fotos')
    expect(mediaCount(es, 3, 0)).toBe('3 fotos')
    expect(mediaCount(es, 1, 1)).toBe('1 vídeo')
    expect(mediaCount(es, 3, 1)).toBe('2 fotos · 1 vídeo')
    expect(mediaCount(en, 5, 2)).toBe('3 photos · 2 videos')
  })
})
