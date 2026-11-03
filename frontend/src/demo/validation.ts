/**
 * Request validation of the demo API, mirroring the backend's pydantic contracts
 * (src/timelife/contracts.py): stripped strings, single-line text, lengths, patterns, ids and
 * literals. Failures answer like FastAPI: 422 `{"code": "invalid_request", "fields": {field: type}}`
 * with pydantic's error types, which the frontend translates (errors.validation.*).
 */

import { passwordProblem } from '../auth/passwordRules'

/** An API error answered as `{"code", "fields"?, "detail"?}` (src/timelife/errors.py). */
export class DemoApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string>
  readonly detail?: Record<string, unknown>

  constructor(status: number, code: string, extra: { fields?: Record<string, string>; detail?: Record<string, unknown> } = {}) {
    super(`${code} (${status})`)
    this.name = 'DemoApiError'
    this.status = status
    this.code = code
    this.fields = extra.fields
    this.detail = extra.detail
  }

  get payload(): Record<string, unknown> {
    return {
      code: this.code,
      ...(this.fields && Object.keys(this.fields).length > 0 ? { fields: this.fields } : {}),
      ...(this.detail ? { detail: this.detail } : {}),
    }
  }
}

const ID_MAX = 2_147_483_647
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTROL = /\p{Cc}/u

/** Collapses whitespace runs (newlines included); null when there are control characters. */
export function singleLine(value: string): string | null {
  const collapsed = value.split(/\s+/u).filter(Boolean).join(' ')
  return CONTROL.test(collapsed) ? null : collapsed
}

function multiline(value: string): string | null {
  const text = value.replace(/\r\n?/g, '\n')
  return /[^\P{Cc}\n\t]/u.test(text) ? null : text
}

export function isISODateString(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Canonical (lower-case, hyphenated) form of a UUID. */
export function uuidOf(value: string): string {
  const hex = value.replace(/-/g, '').toLowerCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

interface TextOptions {
  min?: number
  max: number
  /** `single` collapses whitespace (titles, names), `multi` keeps line breaks (notes). */
  lines?: 'single' | 'multi'
}

/** One JSON body being validated: read every field, then call {@link Body.done}. */
export class Body {
  private readonly issues: Record<string, string> = {}
  private readonly record: Record<string, unknown>
  private readonly known = new Set<string>()
  /** Fields present in the body (PATCH semantics). */
  readonly present: ReadonlySet<string>

  constructor(body: unknown) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new DemoApiError(422, 'invalid_request', { fields: { body: 'model_attributes_type' } })
    }
    this.record = body as Record<string, unknown>
    this.present = new Set(Object.keys(this.record))
  }

  private fail(field: string, type: string): null {
    if (!(field in this.issues)) this.issues[field] = type
    return null
  }

  private read(key: string): unknown {
    this.known.add(key)
    return this.record[key]
  }

  /** Throws the collected errors; unknown fields are refused (`extra="forbid"`). */
  done(): void {
    for (const key of Object.keys(this.record)) if (!this.known.has(key)) this.fail(key, 'extra_forbidden')
    if (Object.keys(this.issues).length > 0) throw new DemoApiError(422, 'invalid_request', { fields: { ...this.issues } })
  }

  /** Records `type` for `field` unless `condition` holds (rules spanning a whole field). */
  check(condition: boolean, field: string, type: string): void {
    if (!condition) this.fail(field, type)
  }

  /** Required string (stripped), or `fallback` when absent. */
  text(key: string, { min = 1, max, lines = 'single' }: TextOptions, fallback?: string): string {
    const raw = this.read(key)
    if (raw === undefined && fallback !== undefined) return fallback
    if (raw === undefined) return this.fail(key, 'missing') ?? ''
    if (typeof raw !== 'string') return this.fail(key, 'string_type') ?? ''
    const stripped = raw.trim()
    if (stripped.length < min) return this.fail(key, 'string_too_short') ?? ''
    if (stripped.length > max) return this.fail(key, 'string_too_long') ?? ''
    const value = lines === 'single' ? singleLine(stripped) : multiline(stripped)
    return value ?? this.fail(key, 'value_error') ?? ''
  }

  /** Optional string where blank means null (location, user name). */
  optionalText(key: string, options: TextOptions): string | null {
    const raw = this.read(key)
    if (raw === undefined || raw === null) return null
    if (typeof raw !== 'string') return this.fail(key, 'string_type')
    const stripped = raw.trim()
    if (!stripped) return null
    if (stripped.length > options.max) return this.fail(key, 'string_too_long')
    const value = singleLine(stripped)
    return value ?? this.fail(key, 'value_error')
  }

  /** Required string matching `pattern` (icon, hex colour). */
  pattern(key: string, pattern: RegExp): string {
    const raw = this.read(key)
    if (raw === undefined) return this.fail(key, 'missing') ?? ''
    if (typeof raw !== 'string') return this.fail(key, 'string_type') ?? ''
    const value = raw.trim()
    return pattern.test(value) ? value : (this.fail(key, 'string_pattern_mismatch') ?? '')
  }

  date(key: string, { optional = false }: { optional?: boolean } = {}): string | null {
    const raw = this.read(key)
    if (raw === undefined || (optional && raw === null)) return optional ? null : this.fail(key, 'missing')
    if (typeof raw !== 'string' || !isISODateString(raw.trim())) return this.fail(key, 'date_from_datetime_parsing')
    return raw.trim()
  }

  id(key: string): number {
    const raw = this.read(key)
    if (raw === undefined) return this.fail(key, 'missing') ?? 0
    if (typeof raw !== 'number' || !Number.isInteger(raw)) return this.fail(key, 'int_parsing') ?? 0
    if (raw < 1) return this.fail(key, 'greater_than_equal') ?? 0
    if (raw > ID_MAX) return this.fail(key, 'less_than_equal') ?? 0
    return raw
  }

  /** List of ids: `min`..`max` items, optionally unique. */
  ids(key: string, { min = 0, max = Infinity, unique = false }: { min?: number; max?: number; unique?: boolean } = {}): number[] {
    const raw = this.read(key)
    if (raw === undefined) return this.fail(key, 'missing') ?? []
    if (!Array.isArray(raw)) return this.fail(key, 'list_type') ?? []
    if (raw.length < min) return this.fail(key, 'too_short') ?? []
    if (raw.length > max) return this.fail(key, 'too_long') ?? []
    if (raw.some((item) => typeof item !== 'number' || !Number.isInteger(item))) return this.fail(key, 'int_parsing') ?? []
    if (raw.some((item) => item < 1 || item > ID_MAX)) return this.fail(key, 'greater_than_equal') ?? []
    if (unique && new Set(raw).size !== raw.length) return this.fail(key, 'value_error') ?? []
    return raw as number[]
  }

  uuid(key: string, { optional = false }: { optional?: boolean } = {}): string | null {
    const raw = this.read(key)
    if (raw === null || (raw === undefined && optional)) return null
    if (raw === undefined) return this.fail(key, 'missing')
    return isUuid(raw) ? uuidOf(raw) : this.fail(key, 'uuid_parsing')
  }

  literal<T extends string>(key: string, options: readonly T[], fallback?: T): T {
    const raw = this.read(key)
    if (raw === undefined && fallback !== undefined) return fallback
    if (raw === undefined) return this.fail(key, 'missing') ?? options[0]
    return options.includes(raw as T) ? (raw as T) : (this.fail(key, 'literal_error') ?? options[0])
  }

  /** `null` (or absent) means "no change" for PATCH-like fields. */
  optionalLiteral<T extends string>(key: string, options: readonly T[]): T | null {
    const raw = this.read(key)
    if (raw === undefined || raw === null) return null
    return options.includes(raw as T) ? (raw as T) : this.fail(key, 'literal_error')
  }

  optionalBoolean(key: string): boolean | null {
    const raw = this.read(key)
    if (raw === undefined || raw === null) return null
    return typeof raw === 'boolean' ? raw : this.fail(key, 'bool_parsing')
  }

  number(key: string, { min, max }: { min: number; max: number }): number {
    const raw = this.read(key)
    if (raw === undefined) return this.fail(key, 'missing') ?? min
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return this.fail(key, 'float_parsing') ?? min
    if (raw < min) return this.fail(key, 'greater_than_equal') ?? min
    if (raw > max) return this.fail(key, 'less_than_equal') ?? min
    return raw
  }

  email(key: string): string {
    const raw = this.read(key)
    if (raw === undefined) return this.fail(key, 'missing') ?? ''
    if (typeof raw !== 'string') return this.fail(key, 'string_type') ?? ''
    const value = raw.trim().toLowerCase()
    return EMAIL.test(value) && value.length <= 254 ? value : (this.fail(key, 'value_error') ?? '')
  }

  /** A password being chosen, as typed (not stripped): `NewPassword` of the API. */
  password(key: string, { optional = false }: { optional?: boolean } = {}): string | null {
    const raw = this.read(key)
    if (optional && (raw === undefined || raw === null)) return null
    if (raw === undefined) return this.fail(key, 'missing')
    if (typeof raw !== 'string') return this.fail(key, 'string_type')
    const problem = passwordProblem(raw)
    if (problem === 'tooShort' || problem === 'required') return this.fail(key, 'string_too_short')
    if (problem === 'tooLong') return this.fail(key, 'string_too_long')
    return problem ? this.fail(key, 'value_error') : raw
  }

  /** List of objects, each validated by `item` (errors are reported under the item's field names). */
  list<T>(key: string, { max }: { max: number }, item: (entry: Body) => T): T[] {
    const raw = this.read(key)
    if (raw === undefined) return []
    if (!Array.isArray(raw)) return this.fail(key, 'list_type') ?? []
    if (raw.length > max) return this.fail(key, 'too_long') ?? []
    const values: T[] = []
    for (const entry of raw) {
      try {
        const body = new Body(entry)
        values.push(item(body))
        body.done()
      } catch (error) {
        if (!(error instanceof DemoApiError)) throw error
        for (const [field, type] of Object.entries(error.fields ?? { [key]: 'model_attributes_type' })) this.fail(field, type)
      }
    }
    return values
  }

  /** Optional nested object validated by `read` (errors under its own field names); null if absent. */
  optionalObject<T>(key: string, read: (entry: Body) => T): T | null {
    const raw = this.read(key)
    if (raw === undefined || raw === null) return null
    if (typeof raw !== 'object' || Array.isArray(raw)) return this.fail(key, 'model_type')
    try {
      const body = new Body(raw)
      const value = read(body)
      body.done()
      return value
    } catch (error) {
      if (!(error instanceof DemoApiError)) throw error
      for (const [field, type] of Object.entries(error.fields ?? { [key]: 'model_type' })) this.fail(field, type)
      return null
    }
  }
}

/** Validates a JSON body with `read` (which reads every field of the contract). */
export function parseBody<T>(body: unknown, read: (body: Body) => T): T {
  const input = new Body(body)
  const value = read(input)
  input.done()
  return value
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
export const ICON_PATTERN = /^[a-z0-9-]{1,64}$/
