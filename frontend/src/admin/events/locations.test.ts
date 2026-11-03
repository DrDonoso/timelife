import { describe, expect, it } from 'vitest'
import type { LocationOut } from '../../api/schema.gen'
import { MAX_LOCATION_SUGGESTIONS, suggestLocations } from './locations'

const PLACES: LocationOut[] = [
  { name: 'Casa de los abuelos', count: 9 },
  { name: 'Esplugues', count: 5 },
  { name: 'Parque de la Ciutadella', count: 3 },
  { name: 'Esplugues de Llobregat', count: 2 },
  { name: 'Málaga', count: 1 },
]

const names = (places: LocationOut[]) => places.map((place) => place.name)

describe('suggestLocations', () => {
  it('finds places by the start of a word, in the order of use', () => {
    expect(names(suggestLocations(PLACES, 'Espl'))).toEqual(['Esplugues', 'Esplugues de Llobregat'])
    expect(names(suggestLocations(PLACES, 'parque'))).toEqual(['Parque de la Ciutadella'])
  })

  it('ignores accents and case, and finds every typed word anywhere in the name', () => {
    expect(names(suggestLocations(PLACES, 'MALA'))).toEqual(['Málaga'])
    expect(names(suggestLocations(PLACES, 'llob esp'))).toEqual(['Esplugues de Llobregat'])
    expect(names(suggestLocations(PLACES, 'de'))).toEqual(['Casa de los abuelos', 'Parque de la Ciutadella', 'Esplugues de Llobregat'])
    expect(suggestLocations(PLACES, 'Madrid')).toEqual([])
  })

  it('leaves out the place already typed in full, but not the longer ones', () => {
    expect(names(suggestLocations(PLACES, '  esplugues '))).toEqual(['Esplugues de Llobregat'])
    expect(suggestLocations(PLACES, 'Málaga')).toEqual([])
  })

  it('offers the most used places when nothing is typed, up to the limit', () => {
    expect(names(suggestLocations(PLACES, ''))).toEqual(names(PLACES))
    const many = Array.from({ length: 20 }, (_, index) => ({ name: `Sitio ${index}`, count: 20 - index }))
    expect(suggestLocations(many, '')).toHaveLength(MAX_LOCATION_SUGGESTIONS)
    expect(names(suggestLocations(many, 'sitio 1', 3))).toEqual(['Sitio 10', 'Sitio 11', 'Sitio 12'])
  })
})
