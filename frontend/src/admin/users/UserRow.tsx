import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconBrandGoogleFilled,
  IconClockHour4,
  IconKey,
  IconKeyOff,
  IconLock,
  IconPasswordUser,
  IconTrash,
} from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { api } from '../../api/client'
import { qk } from '../../api/queries'
import type { UserOut, UserUpdateIn } from '../../api/schema.gen'
import { Avatar } from '../../components/Avatar'
import { IconButton } from '../../components/IconButton'
import { Select } from '../../components/Select'
import { Switch } from '../../components/Switch'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../../i18n'
import { relativeTime } from './relativeTime'
import styles from './UsersPage.module.css'

type Role = UserOut['role']

export interface UserRowProps {
  user: UserOut
  /** Signed-in administrator (their own row is locked). */
  currentUserId: number | null
  /** Google sign-in is configured on the server. */
  googleEnabled: boolean
  /** Reference time for "last login" (fixed per render of the list). */
  now: number
  onDelete: (user: UserOut) => void
  /** Give the user a new temporary password. */
  onPassword: (user: UserOut) => void
}

/** Shared state and actions of a user row (table) or card (mobile). */
function useUserRow({ user, currentUserId }: Pick<UserRowProps, 'user' | 'currentUserId'>) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const isSelf = user.id === currentUserId
  const lockReason = isSelf ? t('adminUsers.lock.self') : null

  const update = useMutation({
    mutationFn: (body: UserUpdateIn) => api.patch<UserOut>(`/api/admin/users/${user.id}`, body),
    onSuccess: (saved, body) => {
      queryClient.setQueryData<UserOut[]>(qk.users, (list) => list?.map((item) => (item.id === saved.id ? saved : item)))
      let message: string
      if (body.role) message = t('adminUsers.toast.role', { email: saved.email, role: t(`common.roles.${saved.role}`) })
      else message = t(saved.disabled ? 'adminUsers.toast.disabled' : 'adminUsers.toast.enabled', { email: saved.email })
      show({ tone: 'success', message })
      void queryClient.invalidateQueries({ queryKey: qk.users })
    },
    onError: (error) => {
      show({ tone: 'error', message: errorMessage(error) })
      void queryClient.invalidateQueries({ queryKey: qk.users })
    },
  })

  // While a change is in flight, show the requested value.
  const pending = update.isPending ? update.variables : undefined
  const role: Role = pending?.role ?? user.role
  const enabled = pending?.disabled != null ? !pending.disabled : !user.disabled

  return { isSelf, lockReason, update, role, enabled, busy: update.isPending }
}

function UserIdentity({ user, isSelf }: { user: UserOut; isSelf: boolean }) {
  const { t } = useI18n()
  const displayName = user.name?.trim() || user.email
  return (
    <div className={styles.identity}>
      <Avatar name={displayName} size="md" decorative />
      <div className={styles.identityText}>
        <span className={styles.identityName}>
          <span className={styles.nameText}>{displayName}</span>
          {isSelf && <span className={styles.badge} data-tone="self">{t('adminUsers.you')}</span>}
          {user.disabled && <span className={styles.badge} data-tone="disabled">{t('adminUsers.disabledBadge')}</span>}
        </span>
        {user.name?.trim() && <span className={styles.email}>{user.email}</span>}
      </div>
    </div>
  )
}

/** How the user signs in: their password (set, temporary or none) and, with Google, its link. */
function AccessStatus({ user, googleEnabled }: { user: UserOut; googleEnabled: boolean }) {
  const { t } = useI18n()
  let password: ReactNode
  if (user.must_change_password) {
    password = (
      <span className={styles.accessItem} data-state="pending" title={t('adminUsers.password.temporaryHint')}>
        <IconPasswordUser size={16} stroke={2} aria-hidden="true" />
        {t('adminUsers.password.temporary')}
      </span>
    )
  } else if (user.has_password) {
    password = (
      <span className={styles.accessItem} data-state="ok" title={t('adminUsers.password.setHint')}>
        <IconKey size={16} stroke={2} aria-hidden="true" />
        {t('adminUsers.password.set')}
      </span>
    )
  } else if (googleEnabled) {
    password = (
      <span className={styles.accessItem} title={t('adminUsers.password.noneHintGoogle')}>
        <IconKeyOff size={16} stroke={2} aria-hidden="true" />
        {t('adminUsers.password.none')}
      </span>
    )
  } else {
    password = (
      <span className={styles.accessItem} data-state="missing" title={t('adminUsers.password.noneHint')}>
        <IconKeyOff size={16} stroke={2} aria-hidden="true" />
        {t('adminUsers.password.none')}
      </span>
    )
  }
  let google: ReactNode = null
  if (user.google_linked) {
    google = (
      <span className={styles.accessItem} data-state="ok" title={t('adminUsers.google.linkedHint')}>
        <IconBrandGoogleFilled size={16} aria-hidden="true" />
        {t('adminUsers.google.linked')}
      </span>
    )
  } else if (googleEnabled) {
    google = (
      <span className={styles.accessItem} title={t('adminUsers.google.pendingHint')}>
        <IconClockHour4 size={16} stroke={2} aria-hidden="true" />
        {t('adminUsers.google.pending')}
      </span>
    )
  }
  return (
    <div className={styles.access}>
      {password}
      {google}
    </div>
  )
}

function LastLogin({ value, now }: { value: string | null; now: number }) {
  const { t, locale, formatDate } = useI18n()
  if (!value) return <span className={styles.never}>{t('adminUsers.never')}</span>
  return (
    <time dateTime={value} title={formatDate(value, 'dateTime')} className={styles.lastLogin}>
      {relativeTime(value, locale, now)}
    </time>
  )
}

interface ControlsProps {
  user: UserOut
  row: ReturnType<typeof useUserRow>
}

function RoleControl({ user, row }: ControlsProps) {
  const { t } = useI18n()
  return (
    <Select<Role>
      aria-label={t('adminUsers.roleLabel', { email: user.email })}
      size="sm"
      options={[
        { value: 'viewer', label: t('common.roles.viewer') },
        { value: 'admin', label: t('common.roles.admin') },
      ]}
      value={row.role}
      onChange={(role) => {
        if (role !== user.role) row.update.mutate({ role })
      }}
      isDisabled={row.lockReason !== null || row.busy}
      className={styles.roleSelect}
    />
  )
}

function AccessControl({ user, row, children }: ControlsProps & { children?: ReactNode }) {
  const { t } = useI18n()
  return (
    <Switch
      // Contains the visible "Activo" text plus whose access it is.
      aria-label={t('adminUsers.enabledLabel', { email: user.email })}
      isSelected={row.enabled}
      onChange={(isSelected) => row.update.mutate({ disabled: !isSelected })}
      isDisabled={row.lockReason !== null || row.busy}
    >
      {children}
    </Switch>
  )
}

interface RowActionsProps {
  user: UserOut
  row: ReturnType<typeof useUserRow>
  onDelete: (user: UserOut) => void
  onPassword: (user: UserOut) => void
}

function RowActions({ user, row, onDelete, onPassword }: RowActionsProps) {
  const { t } = useI18n()
  const { show } = useToast()
  if (row.lockReason) {
    const reason = row.lockReason
    return (
      <IconButton
        size="sm"
        icon={IconLock}
        label={reason}
        tooltipPlacement="start"
        // Touch screens have no hover tooltip: tapping explains why the row is locked.
        onPress={(event) => {
          if (event.pointerType !== 'mouse' && event.pointerType !== 'keyboard') show({ tone: 'info', message: reason })
        }}
        className={styles.lockButton}
      />
    )
  }
  return (
    <span className={styles.rowActions}>
      <IconButton
        size="sm"
        icon={IconKey}
        label={t(user.has_password ? 'adminUsers.resetPassword' : 'adminUsers.setPassword', { email: user.email })}
        tooltipPlacement="start"
        isDisabled={row.busy}
        onPress={() => onPassword(user)}
      />
      <IconButton
        size="sm"
        variant="danger"
        icon={IconTrash}
        label={t('adminUsers.delete', { email: user.email })}
        tooltipPlacement="start"
        isDisabled={row.busy}
        onPress={() => onDelete(user)}
      />
    </span>
  )
}

/** Desktop table row. */
export function UserTableRow({ user, currentUserId, googleEnabled, now, onDelete, onPassword }: UserRowProps) {
  const row = useUserRow({ user, currentUserId })
  return (
    <tr className={styles.tableRow} data-disabled={user.disabled || undefined}>
      <td>
        <UserIdentity user={user} isSelf={row.isSelf} />
      </td>
      <td>
        <RoleControl user={user} row={row} />
      </td>
      <td>
        <AccessControl user={user} row={row} />
      </td>
      <td>
        <AccessStatus user={user} googleEnabled={googleEnabled} />
      </td>
      <td>
        <LastLogin value={user.last_login_at} now={now} />
      </td>
      <td className={styles.actionsCell}>
        <RowActions user={user} row={row} onDelete={onDelete} onPassword={onPassword} />
      </td>
    </tr>
  )
}

/** Mobile card with the same controls. */
export function UserCard({ user, currentUserId, googleEnabled, now, onDelete, onPassword }: UserRowProps) {
  const { t } = useI18n()
  const row = useUserRow({ user, currentUserId })
  return (
    <article className={styles.userCard} data-disabled={user.disabled || undefined}>
      <div className={styles.cardTop}>
        <UserIdentity user={user} isSelf={row.isSelf} />
        <RowActions user={user} row={row} onDelete={onDelete} onPassword={onPassword} />
      </div>
      <div className={styles.cardControls}>
        <RoleControl user={user} row={row} />
        <AccessControl user={user} row={row}>
          {t('adminUsers.table.enabled')}
        </AccessControl>
      </div>
      <dl className={styles.cardMeta}>
        <div>
          <dt>{t('adminUsers.table.access')}</dt>
          <dd>
            <AccessStatus user={user} googleEnabled={googleEnabled} />
          </dd>
        </div>
        <div>
          <dt>{t('adminUsers.table.lastLogin')}</dt>
          <dd>
            <LastLogin value={user.last_login_at} now={now} />
          </dd>
        </div>
      </dl>
      {row.lockReason && <p className={styles.lockNote}>{row.lockReason}</p>}
    </article>
  )
}
