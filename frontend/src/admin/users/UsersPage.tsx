import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconUsers } from '@tabler/icons-react'
import { useState } from 'react'
import { api } from '../../api/client'
import { qk, useAuthConfig } from '../../api/queries'
import type { UserOut } from '../../api/schema.gen'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { LoadingState } from '../../components/Spinner'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../../i18n'
import { useDocumentTitle } from '../../utils/useDocumentTitle'
import { useIsMobile } from '../../utils/useMediaQuery'
import { InviteForm } from './InviteForm'
import { PasswordDialog } from './PasswordDialog'
import { UserCard, UserTableRow } from './UserRow'
import styles from './UsersPage.module.css'

function useUsers() {
  return useQuery({
    queryKey: qk.users,
    queryFn: ({ signal }) => api.get<UserOut[]>('/api/admin/users', { signal }),
  })
}

export function UsersPage() {
  const { t } = useI18n()
  useDocumentTitle(t('admin.nav.users'), t('admin.title'))
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const { user: me } = useAuth()
  const googleEnabled = useAuthConfig().data?.google_enabled ?? false
  const isMobile = useIsMobile()
  const users = useUsers()
  const list = users.data ?? []
  // "Last login" is relative to when the list was rendered.
  const [now] = useState(() => Date.now())
  const [deleting, setDeleting] = useState<UserOut | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [passwordFor, setPasswordFor] = useState<UserOut | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)

  const remove = useMutation({
    mutationFn: (user: UserOut) => api.del(`/api/admin/users/${user.id}`),
    onSuccess: async (_, user) => {
      queryClient.setQueryData<UserOut[]>(qk.users, (current) => current?.filter((item) => item.id !== user.id))
      show({ tone: 'success', message: t('adminUsers.toast.deleted', { email: user.email }) })
      await queryClient.invalidateQueries({ queryKey: qk.users })
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: qk.users }),
  })

  function askDelete(user: UserOut) {
    setDeleting(user)
    setDeleteOpen(true)
  }

  function askPassword(user: UserOut) {
    setPasswordFor(user)
    setPasswordOpen(true)
  }

  let content
  if (users.isPending) {
    content = <LoadingState message={t('common.loading')} />
  } else if (users.isError) {
    content = (
      <EmptyState
        tone="error"
        icon={IconAlertTriangle}
        title={t('adminUsers.loadError')}
        description={errorMessage(users.error)}
        actions={<Button onPress={() => void users.refetch()}>{t('common.retry')}</Button>}
      />
    )
  } else {
    const rowProps = { currentUserId: me?.id ?? null, googleEnabled, now, onDelete: askDelete, onPassword: askPassword }
    content = (
      <section className={styles.panel} aria-labelledby="users-heading">
        <header className={styles.panelHeader}>
          <h2 id="users-heading" className={styles.panelTitle}>
            {t('adminUsers.count', { count: list.length })}
          </h2>
        </header>
        {isMobile ? (
          <ul className={styles.cards} role="list">
            {list.map((user) => (
              <li key={user.id}>
                <UserCard user={user} {...rowProps} />
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="visually-hidden">{t('adminUsers.table.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('adminUsers.table.user')}</th>
                  <th scope="col">{t('adminUsers.table.role')}</th>
                  <th scope="col">{t('adminUsers.table.enabled')}</th>
                  <th scope="col">{t('adminUsers.table.access')}</th>
                  <th scope="col">{t('adminUsers.table.lastLogin')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('adminUsers.table.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((user) => (
                  <UserTableRow key={user.id} user={user} {...rowProps} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )
  }

  return (
    <>
      <PageHeader icon={IconUsers} title={t('admin.nav.users')} description={t('adminUsers.description')} />
      <div className={styles.layout}>
        <InviteForm users={list} />
        {content}
      </div>
      <ConfirmDialog
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('adminUsers.confirmDelete.title', { email: deleting?.email ?? '' })}
        confirmLabel={t('adminUsers.confirmDelete.confirm')}
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      >
        {t('adminUsers.confirmDelete.message')}
      </ConfirmDialog>
      <PasswordDialog user={passwordFor} isOpen={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  )
}
