import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { LINK_TOKEN } from './passwordRules'

/**
 * The code of an e-mailed or recovery link (`/reset-password#<code>`, `/setup#<code>`), or null.
 * The fragment never reaches the server (nor its logs); once read it also leaves the address bar
 * and the history.
 */
export function useLinkToken(): string | null {
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(() => {
    const value = location.hash.replace(/^#/, '')
    return LINK_TOKEN.test(value) ? value : null
  })
  const { hash, pathname, search } = location
  useEffect(() => {
    if (hash) void navigate({ pathname, search }, { replace: true })
  }, [hash, pathname, search, navigate])
  return token
}
