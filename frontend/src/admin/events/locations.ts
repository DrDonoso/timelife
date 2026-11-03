import type { LocationOut } from '../../api/schema.gen'
import { searchTokens } from '../../search/searchText'

/** Places listed under the location field at most. */
export const MAX_LOCATION_SUGGESTIONS = 8

/**
 * Places to suggest while typing a location: those containing every typed word, accents and case
 * ignored (`espl` finds "Esplugues"), in the API's order (most used first), leaving out the place
 * already typed in full. With nothing typed, the most used places.
 */
export function suggestLocations(places: readonly LocationOut[], typed: string, max = MAX_LOCATION_SUGGESTIONS): LocationOut[] {
  const tokens = searchTokens(typed)
  const exact = tokens.join(' ')
  const found: LocationOut[] = []
  for (const place of places) {
    if (found.length >= max) break
    const words = searchTokens(place.name)
    const name = words.join(' ')
    if (name !== exact && tokens.every((token) => name.includes(token))) found.push(place)
  }
  return found
}
