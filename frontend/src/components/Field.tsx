import { IconAlertCircle } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { FieldError, Label, Text } from 'react-aria-components'
import styles from './Field.module.css'

/** Label for react-aria fields (adds the required asterisk). */
export function FieldLabel({ children, isRequired, id }: { children: ReactNode; isRequired?: boolean; id?: string }) {
  return (
    <Label className={styles.label} id={id}>
      {children}
      {isRequired && (
        <span className={styles.required} aria-hidden="true">
          *
        </span>
      )}
    </Label>
  )
}

export function FieldDescription({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <Text slot="description" className={styles.description}>
      {children}
    </Text>
  )
}

/** Shows `children` (or the native validation messages) while the field is invalid. */
export function FieldErrorMessage({ children }: { children?: ReactNode }) {
  return (
    <FieldError className={styles.error}>
      {(validation) => (
        <>
          <IconAlertCircle size={14} stroke={2.2} aria-hidden="true" className={styles.errorIcon} />
          <span>{children ?? validation.validationErrors.join(' ')}</span>
        </>
      )}
    </FieldError>
  )
}

/** Error line for custom (non react-aria) field groups. */
export function StaticFieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p className={styles.error} id={id}>
      <IconAlertCircle size={14} stroke={2.2} aria-hidden="true" className={styles.errorIcon} />
      <span>{children}</span>
    </p>
  )
}

/** Plain label/description for custom field groups (wired with ids by the caller). */
export function StaticFieldLabel({ id, children, isRequired }: { id: string; children: ReactNode; isRequired?: boolean }) {
  return (
    <span className={styles.label} id={id}>
      {children}
      {isRequired && (
        <span className={styles.required} aria-hidden="true">
          *
        </span>
      )}
    </span>
  )
}

export function StaticFieldDescription({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p className={styles.description} id={id}>
      {children}
    </p>
  )
}
