import { describe, expect, it } from 'vitest'
import { formatNumber } from '../i18n/translate'
import { formatBytes } from './bytes'

describe('formatBytes', () => {
  it('picks the unit and the decimals for each language', () => {
    const es = (value: number, options?: Intl.NumberFormatOptions) => formatNumber('es', value, options)
    const en = (value: number, options?: Intl.NumberFormatOptions) => formatNumber('en', value, options)
    expect(formatBytes(es, 1536)).toBe('2 kB')
    expect(formatBytes(es, 5 * 1024 * 1024)).toBe('5 MB')
    expect(formatBytes(es, 1.5 * 1024 ** 3)).toBe('1,5 GB')
    expect(formatBytes(en, 1.5 * 1024 ** 3)).toBe('1.5 GB')
    expect(formatBytes(en, 3 * 1024 ** 4)).toBe('3 TB')
    expect(formatBytes(es, 10)).toBe('10 B')
    expect(formatBytes(en, 10)).toBe('10 B')
    expect(formatBytes(en, -5)).toBe('0 B')
  })
})
