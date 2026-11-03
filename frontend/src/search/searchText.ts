/**
 * Client-side mirror of the backend search (`timelife.text.normalize_search` / `search_tokens`):
 * NFKD, combining marks removed, case-folded, whitespace-separated tokens that must ALL be
 * contained in the title. Used to keep the typeahead in step with what the user is typing while
 * the debounced URL `q` catches up, and to highlight matches accent-insensitively.
 */

/** Maximum length of `q` accepted by the API (`SearchQuery`, 200 characters). */
export const MAX_QUERY_LENGTH = 200

const COMBINING_MARKS = /\p{M}/gu

/** Trimmed, single-spaced and capped to {@link MAX_QUERY_LENGTH} characters (code points). */
export function normalizeQuery(value: string | null | undefined): string {
  if (!value) return ''
  const collapsed = value.trim().replace(/\s+/gu, ' ')
  const chars = Array.from(collapsed)
  return chars.length > MAX_QUERY_LENGTH ? chars.slice(0, MAX_QUERY_LENGTH).join('').trimEnd() : collapsed
}

/** Accent- and case-insensitive form of one character (may expand: `ß` → `ss`, `ﬁ` → `fi`). */
function foldChar(char: string): string {
  return char.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase().replace(/ß/gu, 'ss')
}

/** Accent- and case-insensitive form of `text` (same idea as the backend's `title_search`). */
export function foldText(text: string): string {
  let folded = ''
  for (const char of text) folded += foldChar(char)
  return folded
}

/** Distinct folded tokens of a query (empty for a blank query). */
export function searchTokens(query: string): string[] {
  return [...new Set(foldText(query).split(/\s+/u).filter(Boolean))]
}

/** True when every token appears in `text` (accent/case-insensitive). No tokens → true. */
export function matchesTokens(text: string, tokens: readonly string[]): boolean {
  const folded = foldText(text)
  return tokens.every((token) => folded.includes(token))
}

export interface TextSegment {
  text: string
  match: boolean
}

/**
 * Splits `text` into matched / unmatched segments for every occurrence of every token, mapping
 * positions in the folded text back to the original characters (accents and expansions included).
 */
export function highlightSegments(text: string, tokens: readonly string[]): TextSegment[] {
  if (!text) return []
  // For each UTF-16 unit of the folded text: start/end offsets of its source character in `text`.
  let folded = ''
  const starts: number[] = []
  const ends: number[] = []
  let offset = 0
  for (const char of text) {
    const piece = foldChar(char)
    if (!piece && ends.length > 0) {
      // A combining mark (or other folded-away character) stays with the previous character.
      ends[ends.length - 1] = offset + char.length
    }
    for (let index = 0; index < piece.length; index += 1) {
      starts.push(offset)
      ends.push(offset + char.length)
    }
    folded += piece
    offset += char.length
  }

  const ranges: Array<[number, number]> = []
  for (const token of tokens) {
    if (!token) continue
    let from = folded.indexOf(token)
    while (from !== -1) {
      ranges.push([starts[from], ends[from + token.length - 1]])
      from = folded.indexOf(token, from + 1)
    }
  }
  if (ranges.length === 0) return [{ text, match: false }]

  const merged: Array<[number, number]> = []
  for (const [start, end] of ranges.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }

  const segments: TextSegment[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false })
    segments.push({ text: text.slice(start, end), match: true })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false })
  return segments
}

/** 0 when every token starts a word of `text`, 1 otherwise (lower ranks first). */
function rank(text: string, tokens: readonly string[]): number {
  const words = foldText(text).split(/[^\p{L}\p{N}]+/u)
  return tokens.every((token) => words.some((word) => word.startsWith(token))) ? 0 : 1
}

/**
 * Items whose `title` matches every token, word-start matches first; otherwise the original
 * order (newest first) is kept.
 */
export function rankMatches<T extends { title: string }>(items: readonly T[], tokens: readonly string[]): T[] {
  if (tokens.length === 0) return []
  return items
    .filter((item) => matchesTokens(item.title, tokens))
    .map((item, index) => ({ item, index, rank: rank(item.title, tokens) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item)
}
