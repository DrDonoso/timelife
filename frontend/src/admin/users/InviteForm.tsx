import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconMail, IconUser, IconUserPlus } from '@tabler/icons-react'
import { useRef, useState, type FormEvent } from 'react'
import { Form } from 'react-aria-components'
import { api, isApiError } from '../../api/client'
import { qk, useAuthConfig } from '../../api/queries'
import type { UserCreateIn, UserOut } from '../../api/schema.gen'
import { EMAIL_PATTERN, passwordProblem } from '../../auth/passwordRules'
import { Button } from '../../components/Button'
import { Select } from '../../components/Select'
import { TextField } from '../../components/TextField'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useFieldErrors, useI18n } from '../../i18n'
import { TemporaryPasswordField } from './TemporaryPasswordField'
import styles from './UsersPage.module.css'

type Role = UserOut['role']

/**
 * Gives someone access: their e-mail, a role and a temporary password (changed at their first
 * sign-in). With Google sign-in configured the password is optional (Google only).
 */
export function InviteForm({ users }: { users: readonly UserOut[] }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const fieldErrors = useFieldErrors()
  const google = useAuthConfig().data?.google_enabled ?? false
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const invite = useMutation({
    mutationFn: (body: UserCreateIn) => api.post<UserOut>('/api/admin/users', body),
    onSuccess: async (user) => {
      queryClient.setQueryData<UserOut[]>(qk.users, (list) => (list ? [...list.filter((item) => item.id !== user.id), user] : list))
      const message = user.has_password ? 'adminUsers.invite.success' : 'adminUsers.invite.successGoogle'
      show({ tone: 'success', message: t(message, { email: user.email }) })
      setEmail('')
      setName('')
      setRole('viewer')
      setPassword('')
      emailRef.current?.focus()
      await queryClient.invalidateQueries({ queryKey: qk.users })
    },
    onError: (error) => {
      if (isApiError(error, 'user_exists')) {
        setEmailError(t('adminUsers.invite.exists'))
        emailRef.current?.focus()
      } else if (isApiError(error, 'invalid_request') && error.fields?.email) {
        setEmailError(t('adminUsers.invite.invalidEmail'))
        emailRef.current?.focus()
      } else if (isApiError(error, 'invalid_request') && error.fields?.password) {
        setPasswordError(error.fields.password === 'missing' ? t('auth.rules.required') : fieldErrors(error).password)
        passwordRef.current?.focus()
      } else {
        setFormError(errorMessage(error))
      }
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (invite.isPending) return
    setFormError(null)
    const value = email.trim().toLowerCase()
    let problem: string | null = null
    if (!value) problem = t('adminUsers.invite.required')
    else if (!EMAIL_PATTERN.test(value) || value.length > 254) problem = t('adminUsers.invite.invalidEmail')
    else if (users.some((user) => user.email.toLowerCase() === value)) problem = t('adminUsers.invite.exists')
    // With Google the password may stay empty (Google sign-in only).
    const weak = password || !google ? passwordProblem(password) : null
    setEmailError(problem)
    setPasswordError(weak ? t(`auth.rules.${weak}`) : null)
    if (problem) {
      emailRef.current?.focus()
      return
    }
    if (weak) {
      passwordRef.current?.focus()
      return
    }
    invite.mutate({ email: value, role, name: name.trim() || null, password: password || null })
  }

  return (
    <section className={styles.invite} aria-labelledby="invite-heading">
      <div className={styles.inviteIntro}>
        <span className={styles.inviteIcon} aria-hidden="true">
          <IconUserPlus size={22} stroke={1.9} />
        </span>
        <div>
          <h2 id="invite-heading" className={styles.inviteTitle}>
            {t('adminUsers.invite.title')}
          </h2>
          <p className={styles.inviteText}>{google ? t('adminUsers.invite.explanationGoogle') : t('adminUsers.invite.explanation')}</p>
        </div>
      </div>
      <Form className={styles.inviteForm} validationBehavior="aria" onSubmit={submit}>
        <TextField
          label={t('adminUsers.invite.email')}
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value)
            setEmailError(null)
          }}
          placeholder={t('adminUsers.invite.emailPlaceholder')}
          icon={IconMail}
          errorMessage={emailError}
          isRequired
          inputRef={emailRef}
          autoComplete="off"
          className={styles.inviteEmail}
        />
        <TextField
          label={t('adminUsers.invite.name')}
          description={t('adminUsers.invite.nameDescription')}
          value={name}
          onChange={setName}
          icon={IconUser}
          maxLength={120}
          autoComplete="off"
          className={styles.inviteName}
        />
        <Select<Role>
          label={t('adminUsers.invite.role')}
          options={[
            { value: 'viewer', label: t('common.roles.viewer'), description: t('adminUsers.roles.viewer') },
            { value: 'admin', label: t('common.roles.admin'), description: t('adminUsers.roles.admin') },
          ]}
          value={role}
          onChange={setRole}
          className={styles.inviteRole}
        />
        <TemporaryPasswordField
          value={password}
          onChange={(value) => {
            setPassword(value)
            setPasswordError(null)
          }}
          description={google ? t('adminUsers.invite.passwordDescriptionGoogle') : t('adminUsers.invite.passwordDescription')}
          errorMessage={passwordError}
          isRequired={!google}
          inputRef={passwordRef}
          className={styles.invitePassword}
        />
        <Button type="submit" variant="primary" icon={IconUserPlus} isLoading={invite.isPending} className={styles.inviteSubmit}>
          {t('adminUsers.invite.submit')}
        </Button>
      </Form>
      {formError && (
        <p className={styles.formError} role="alert">
          <IconAlertTriangle size={18} aria-hidden="true" />
          {formError}
        </p>
      )}
      <ul className={styles.notes}>
        <li>{t('adminUsers.notes.roles')}</li>
        <li>{t('adminUsers.notes.sessions')}</li>
      </ul>
    </section>
  )
}
