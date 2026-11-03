import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, onUnauthorized } from '../api/client'
import { clearPrivateQueries, qk, useSession } from '../api/queries'
import type { SessionOut, SessionUserOut } from '../api/schema.gen'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  status: AuthStatus
  user: SessionUserOut | null
  isAdmin: boolean
  /** Signs out (idempotent). Rejects with ApiError when the server can't be reached. */
  logout: () => Promise<void>
  /** Stores a session returned by a sign-in endpoint (e.g. dev login). */
  setSession: (session: SessionOut) => void
  /** Set when the session could not be checked at all (network/server error). */
  error: unknown
  retry: () => void
  /** True after an explicit sign-out in this tab: guards go to plain `/login` (no `?next=`). */
  signedOut: boolean
}

const SIGNED_OUT: SessionOut = { authenticated: false, user: null }

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const session = useSession()
  const [signedOut, setSignedOut] = useState(false)

  // Any 401 outside /api/auth means the session expired: re-check it (the guards then show login).
  useEffect(
    () => onUnauthorized(() => void queryClient.invalidateQueries({ queryKey: qk.session })),
    [queryClient],
  )

  const user = session.data?.authenticated ? session.data.user : null
  const status: AuthStatus = session.isPending ? 'loading' : user ? 'authenticated' : 'anonymous'

  // Signed out (or the session expired): drop every cached private query.
  useEffect(() => {
    if (status === 'anonymous') clearPrivateQueries(queryClient)
  }, [status, queryClient])

  const setSession = useCallback(
    (next: SessionOut) => {
      clearPrivateQueries(queryClient)
      setSignedOut(false)
      queryClient.setQueryData(qk.session, next)
    },
    [queryClient],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
    }
    // Before the session flips to anonymous, so the guards never remember the page being left.
    setSignedOut(true)
    queryClient.setQueryData(qk.session, SIGNED_OUT)
    clearPrivateQueries(queryClient)
  }, [queryClient])

  const { refetch } = session
  const retry = useCallback(() => void refetch(), [refetch])
  const error = session.isError && !session.data ? session.error : null

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAdmin: user?.role === 'admin',
      logout,
      setSession,
      error,
      retry,
      signedOut,
    }),
    [status, user, logout, setSession, error, retry, signedOut],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
