import { isISODate, parseISODate } from '../../utils/dates'

export interface ChildAge {
  unit: 'months' | 'years'
  count: number
}

/**
 * Age as parents say it: whole months until two years old, then whole years. `null` for missing,
 * invalid or future birth dates.
 */
export function childAge(birthDate: string | null | undefined, today: Date = new Date()): ChildAge | null {
  if (!birthDate || !isISODate(birthDate)) return null
  const birth = parseISODate(birthDate)
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth())
  if (today.getDate() < birth.getDate()) months -= 1
  if (months < 0) return null
  if (months < 24) return { unit: 'months', count: months }
  return { unit: 'years', count: Math.floor(months / 12) }
}
