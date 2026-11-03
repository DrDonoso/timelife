/** The API's password rules (`NewPassword`): 8-200 characters, not blank, no control characters. */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 200

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Single-use codes of e-mailed and recovery links (`#<code>`). */
export const LINK_TOKEN = /^[0-9a-f]{64}$/

export type PasswordProblem = 'required' | 'tooShort' | 'tooLong' | 'invalid'

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

/** Why `value` cannot be a new password, or null. Lengths count characters, like the server. */
export function passwordProblem(value: string): PasswordProblem | null {
  if (!value) return 'required'
  if (!value.trim() || hasControlCharacters(value)) return 'invalid'
  const length = [...value].length
  if (length < MIN_PASSWORD_LENGTH) return 'tooShort'
  if (length > MAX_PASSWORD_LENGTH) return 'tooLong'
  return null
}

/** Whether two passwords are the same once normalised (NFKC), as the server compares them. */
export function samePassword(first: string, second: string): boolean {
  return first.normalize('NFKC') === second.normalize('NFKC')
}

// No 0/O, 1/l/I: easy to read out and to type.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

function randomNumbers(count: number): number[] {
  const values = new Uint32Array(count)
  crypto.getRandomValues(values)
  return Array.from(values)
}

/** A random temporary password, three groups of four characters (`Kq7m-Tr4x-Hb9p`). */
export function generatePassword(numbers: (count: number) => readonly number[] = randomNumbers): string {
  const characters = numbers(12).map((value) => ALPHABET[value % ALPHABET.length])
  return [0, 4, 8].map((start) => characters.slice(start, start + 4).join('')).join('-')
}
