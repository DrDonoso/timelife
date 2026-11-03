import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import { LanguageMenu } from '../shell/LanguageMenu'
import { ThemeMenu } from '../shell/ThemeMenu'
import styles from './AuthCard.module.css'

/** Error (`role="alert"`) or confirmation (`role="status"`) inside an {@link AuthCard}. */
export function AuthAlert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' }) {
  const success = tone === 'success'
  const Icon = success ? IconCircleCheck : IconAlertTriangle
  return (
    <motion.p
      className={success ? styles.success : styles.alert}
      role={success ? 'status' : 'alert'}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Icon size={18} aria-hidden="true" className={success ? styles.successIcon : styles.alertIcon} />
      <span>{children}</span>
    </motion.p>
  )
}

/**
 * The signed-out pages (sign in, first administrator, new password): the app's name and logo in
 * a card over the patterned background, theme and language in the corner.
 */
export function AuthCard({ children, footnote }: { children: ReactNode; footnote?: ReactNode }) {
  const { t } = useI18n()
  return (
    <main className={styles.page}>
      <div className={styles.corner}>
        <ThemeMenu />
        <LanguageMenu />
      </div>
      <motion.section
        className={styles.card}
        aria-labelledby="login-title"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <img src="/logo.svg" alt="" width={88} height={88} className={styles.logo} />
        <h1 id="login-title" className={styles.title}>
          {t('common.appName')}
        </h1>
        <p className={styles.tagline}>{t('common.tagline')}</p>
        <div className={styles.actions}>{children}</div>
        {footnote && <p className={styles.footnote}>{footnote}</p>}
      </motion.section>
    </main>
  )
}
