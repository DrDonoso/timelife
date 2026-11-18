/**
 * What a notification asks for when it opens the app: the address of its page carries
 * `?memories=open` (open the list of today's memories) or `?memories=seen` (it opens one of them:
 * count them as looked at). main.tsx takes it out of the address before the router starts, so
 * nothing else ever sees it or keeps it, and the memories act on it once (see MemoriesProvider),
 * after signing in when the session had expired.
 */
export type MemoriesIntent = 'open' | 'seen'

export const INTENT_PARAM = 'memories'

let pending: MemoriesIntent | null = null

/** Takes the intent out of the current address (keeping the rest of it) for the memories. */
export function takeLaunchIntent(location: Location = window.location, history: History = window.history): void {
  const url = new URL(location.href)
  const intent = url.searchParams.get(INTENT_PARAM)
  if (intent !== 'open' && intent !== 'seen') return
  pending = intent
  url.searchParams.delete(INTENT_PARAM)
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

/** The intent the app was opened with, once (null afterwards, and without one). */
export function consumeMemoriesIntent(): MemoriesIntent | null {
  const intent = pending
  pending = null
  return intent
}
