import { IconWand } from '@tabler/icons-react'
import { useState, type ReactNode, type Ref } from 'react'
import { generatePassword } from '../../auth/passwordRules'
import { Button } from '../../components/Button'
import { PasswordField } from '../../components/PasswordField'
import { cx } from '../../components/utils'
import { useI18n } from '../../i18n'
import styles from './UsersPage.module.css'

export interface TemporaryPasswordFieldProps {
  value: string
  onChange: (value: string) => void
  description?: ReactNode
  errorMessage?: string | null
  isRequired?: boolean
  inputRef?: Ref<HTMLInputElement>
  autoFocus?: boolean
  className?: string
}

/** A temporary password for someone else, typed or generated (then shown, to pass it on). */
export function TemporaryPasswordField({
  value,
  onChange,
  description,
  errorMessage,
  isRequired,
  inputRef,
  autoFocus,
  className,
}: TemporaryPasswordFieldProps) {
  const { t } = useI18n()
  const [revealed, setRevealed] = useState(false)
  return (
    <div className={cx(styles.passwordGroup, className)}>
      <PasswordField
        label={t('adminUsers.invite.password')}
        description={description}
        name="temporary-password"
        autoComplete="new-password"
        value={value}
        onChange={onChange}
        errorMessage={errorMessage}
        isRequired={isRequired}
        isRevealed={revealed}
        onRevealChange={setRevealed}
        inputRef={inputRef}
        autoFocus={autoFocus}
        className={styles.passwordField}
      />
      <Button
        icon={IconWand}
        aria-label={t('adminUsers.invite.generateLabel')}
        onPress={() => {
          onChange(generatePassword())
          setRevealed(true)
        }}
        className={styles.generate}
      >
        {t('adminUsers.invite.generate')}
      </Button>
    </div>
  )
}
