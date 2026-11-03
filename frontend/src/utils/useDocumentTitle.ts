import { useEffect } from 'react'

/** Sets `document.title` to "part · part · Timelife" (empty parts are skipped). */
export function useDocumentTitle(...parts: Array<string | null | undefined | false>): void {
  const title = [...parts.filter((part): part is string => Boolean(part)), 'Timelife'].join(' · ')
  useEffect(() => {
    document.title = title
  }, [title])
}
