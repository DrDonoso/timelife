/**
 * localStorage access that never throws (private mode, blocked site data) — preferences are a
 * nicety, never a requirement. Keys: `timelife.theme` (light/dark mode), `timelife.palette`
 * (colour palette), `timelife.lang`, `timelife.child`.
 */
export const STORAGE_KEYS = {
  theme: 'timelife.theme',
  palette: 'timelife.palette',
  lang: 'timelife.lang',
  child: 'timelife.child',
} as const

export function readStorage(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key)
    // Accept JSON-encoded strings ("\"dark\"") as well as plain ones, like public/theme-init.js.
    return typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : null
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the preference simply isn't remembered.
  }
}
