import { IconMapQuestion } from '@tabler/icons-react'
import { lazy } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { LinkButton } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useI18n } from '../i18n'
import { RouteErrorPage } from '../pages/RouteErrorPage'

// Admin pages are code-split; each module keeps the named export listed in spec 30.
const EventsPage = lazy(() => import('./events/EventsPage').then((m) => ({ default: m.EventsPage })))
const EventEditorPage = lazy(() => import('./events/EventEditorPage').then((m) => ({ default: m.EventEditorPage })))
const TrashPage = lazy(() => import('./trash/TrashPage').then((m) => ({ default: m.TrashPage })))
const CategoriesPage = lazy(() => import('./categories/CategoriesPage').then((m) => ({ default: m.CategoriesPage })))
const ChildrenPage = lazy(() => import('./children/ChildrenPage').then((m) => ({ default: m.ChildrenPage })))
const AppearancePage = lazy(() => import('./appearance/AppearancePage').then((m) => ({ default: m.AppearancePage })))
const UsersPage = lazy(() => import('./users/UsersPage').then((m) => ({ default: m.UsersPage })))
const BackupPage = lazy(() => import('./backup/BackupPage').then((m) => ({ default: m.BackupPage })))

function AdminNotFound() {
  const { t } = useI18n()
  return (
    <EmptyState
      icon={IconMapQuestion}
      title={t('admin.notFound.title')}
      description={t('admin.notFound.description')}
      actions={
        <LinkButton href="/admin/events" variant="primary">
          {t('admin.notFound.action')}
        </LinkButton>
      }
    />
  )
}

/** Children of the `/admin` layout route (rendered inside AdminLayout's <Outlet/>). */
export const adminRoutes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage inline />,
    children: [
      { index: true, element: <Navigate to="/admin/events" replace /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/new', element: <EventEditorPage /> },
      { path: 'events/:eventId', element: <EventEditorPage /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'children', element: <ChildrenPage /> },
      { path: 'appearance', element: <AppearancePage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'trash', element: <TrashPage /> },
      { path: 'backup', element: <BackupPage /> },
      { path: '*', element: <AdminNotFound /> },
    ],
  },
]
