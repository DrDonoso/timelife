import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router'
import { adminRoutes } from './admin/routes'
import { createQueryClient } from './api/queries'
import { LoadingState } from './components/Spinner'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { I18nProvider, useI18n } from './i18n'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { RouteErrorPage } from './pages/RouteErrorPage'
import { SetupPage } from './pages/SetupPage'
import { TimelinePage } from './pages/TimelinePage'
import { AppShell } from './shell/AppShell'
import { RequireAdmin, RequireAuth, RequireChild, RequireFamily, RootRedirect } from './shell/guards'
import { RootLayout } from './shell/RootLayout'

// Code-split routes: the timeline loads without the admin panel or the event detail (which loads
// the editor only when an admin edits).
const AdminLayout = lazy(() => import('./admin/AdminLayout').then((module) => ({ default: module.AdminLayout })))
const EventDetailRoute = lazy(() =>
  import('./event-detail/EventDetailRoute').then((module) => ({ default: module.EventDetailRoute })),
)
const NewEventRoute = lazy(() => import('./event-detail/NewEventRoute').then((module) => ({ default: module.NewEventRoute })))

/** Shown over the timeline while the event detail code loads (the first time only). */
function EventDetailFallback() {
  const { t } = useI18n()
  return <LoadingState overlay message={t('detail.loading')} />
}

/** Event detail and new-milestone routes, the same under a child's timeline and the family one. */
function timelineChildren(): RouteObject[] {
  return [
    {
      path: 'e/:eventId',
      element: (
        <Suspense fallback={<EventDetailFallback />}>
          <EventDetailRoute />
        </Suspense>
      ),
    },
    {
      path: 'new',
      element: (
        <Suspense fallback={<EventDetailFallback />}>
          <NewEventRoute />
        </Suspense>
      ),
    },
  ]
}

/**
 * Route tree (spec 30):
 * /login · /setup (administrator recovery link) · /reset-password (e-mailed link) · / (→
 * remembered/first child, or the family) · /c/:childSlug (timeline) · /all (every child together)
 * · …/e/:eventId (detail) · …/new (new milestone, admins) · /admin/* (admins, lazy) · * (404)
 */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'setup', element: <SetupPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <RootRedirect /> },
              {
                path: 'c/:childSlug',
                element: (
                  <RequireChild>
                    <TimelinePage />
                  </RequireChild>
                ),
                children: timelineChildren(),
              },
              {
                path: 'all',
                element: (
                  <RequireFamily>
                    <TimelinePage />
                  </RequireFamily>
                ),
                children: timelineChildren(),
              },
            ],
          },
          {
            path: 'admin',
            element: (
              <RequireAdmin>
                <Suspense fallback={<LoadingState fill />}>
                  <AdminLayout />
                </Suspense>
              </RequireAdmin>
            ),
            children: adminRoutes,
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

/** App-wide providers that don't depend on the router (also used by tests). */
export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <AuthProvider>
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
}

export function App() {
  const [queryClient] = useState(createQueryClient)
  const [router] = useState(() => createBrowserRouter(routes))
  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
