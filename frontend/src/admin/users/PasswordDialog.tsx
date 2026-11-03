import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Form } from 'react-aria-components'
import { api, isApiError } from '../../api/client'
import { qk } from '../../api/queries'
import type { UserOut, UserPasswordIn } from '../../api/schema.gen'
import { passwordProblem } from '../../auth/passwordRules'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useFieldErrors, useI18n } from '../../i18n'
import { TemporaryPasswordField } from './TemporaryPasswordField'
import styles from './UsersPage.module.css'

function PasswordForm({ user, close }: { user: UserOut; close: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const fieldErrors = useFieldErrors()
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (body: UserPasswordIn) => api.put<UserOut>(`/api/admin/users/${user.id}/password`, body),
    onSuccess: (saved) => {
      queryClient.setQueryData<UserOut[]>(qk.users, (list) => list?.map((item) => (item.id === saved.id ? saved : item)))
      show({ tone: 'success', message: t('adminUsers.toast.password', { email: saved.email }) })
      void queryClient.invalidateQueries({ queryKey: qk.users })
      close()
    },
    onError: (error) => {
      if (isApiError(error, 'invalid_request') && error.fields?.password) setPasswordError(fieldErrors(error).password)
      else setFormError(errorMessage(error))
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (save.isPending) return
    const problem = passwordProblem(password)
    setPasswordError(problem ? t(`auth.rules.${problem}`) : null)
    setFormError(null)
    if (!problem) save.mutate({ password })
  }

  return (
    <Form className={styles.dialogForm} validationBehavior="aria" onSubmit={submit}>
      <p className={styles.dialogText}>{t('adminUsers.passwordDialog.description')}</p>
      {formError && (
        <p className={styles.formError} role="alert">
          <IconAlertTriangle size={18} aria-hidden="true" />
          {formError}
        </p>
      )}
      <TemporaryPasswordField
        value={password}
        onChange={(value) => {
          setPassword(value)
          setPasswordError(null)
        }}
        description={t('adminUsers.invite.passwordDescription')}
        errorMessage={passwordError}
        isRequired
        autoFocus
      />
      <div className={styles.dialogButtons}>
        <Button onPress={close}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" isLoading={save.isPending}>
          {t('adminUsers.passwordDialog.submit')}
        </Button>
      </div>
    </Form>
  )
}

export interface PasswordDialogProps {
  /** Whose password (kept while the dialog closes). */
  user: UserOut | null
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

/** An administrator gives someone a new temporary password (they change it when signing in). */
export function PasswordDialog({ user, isOpen, onOpenChange }: PasswordDialogProps) {
  const { t } = useI18n()
  return (
    <Modal
      isOpen={isOpen && user !== null}
      onOpenChange={onOpenChange}
      title={user ? t('adminUsers.passwordDialog.title', { email: user.email }) : undefined}
      size="sm"
      fullScreenOnMobile
    >
      {(close) => user && <PasswordForm user={user} close={close} />}
    </Modal>
  )
}
