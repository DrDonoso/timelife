import { describe, expect, it } from 'vitest'
import { generatePassword, passwordProblem, samePassword } from './passwordRules'

describe('passwordProblem', () => {
  it('follows the rules of the API', () => {
    expect(passwordProblem('')).toBe('required')
    expect(passwordProblem('1234567')).toBe('tooShort')
    expect(passwordProblem('12345678')).toBeNull()
    expect(passwordProblem('x'.repeat(200))).toBeNull()
    expect(passwordProblem('x'.repeat(201))).toBe('tooLong')
    expect(passwordProblem(' '.repeat(12))).toBe('invalid')
    expect(passwordProblem('con\ttabulador')).toBe('invalid')
    expect(passwordProblem('salto\nde línea')).toBe('invalid')
    expect(passwordProblem('  espacios  ')).toBeNull()
  })

  it('counts characters like the server (emoji are one)', () => {
    expect(passwordProblem('🐻🐻🐻🐻🐻🐻🐻')).toBe('tooShort')
    expect(passwordProblem('🐻🐻🐻🐻🐻🐻🐻🐻')).toBeNull()
  })
})

describe('samePassword', () => {
  it('compares normalised text', () => {
    expect(samePassword('contrase\u00f1a', 'contrasen\u0303a')).toBe(true)
    expect(samePassword('Contraseña', 'contraseña')).toBe(false)
  })
})

describe('generatePassword', () => {
  it('makes three groups of four unambiguous characters', () => {
    const password = generatePassword()
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/)
    expect(passwordProblem(password)).toBeNull()
    expect(generatePassword((count) => Array.from({ length: count }, (_, index) => index))).toBe('ABCD-EFGH-JKLM')
    expect(new Set(Array.from({ length: 20 }, () => generatePassword())).size).toBe(20)
  })
})
