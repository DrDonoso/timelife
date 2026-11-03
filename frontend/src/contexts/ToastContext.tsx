import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconX } from '@tabler/icons-react'
import { AnimatePresence, motion } from 'motion/react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from 'react-aria-components'
import { Link } from 'react-router'
import { useI18n } from '../i18n'
import styles from './Toast.module.css'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  /** In-app link (react-router path). */
  to?: string
  onPress?: () => void
}

export interface ToastOptions {
  tone?: ToastTone
  message: string
  action?: ToastAction
  /** Milliseconds before auto-dismiss (default 5 s, errors 8 s). */
  duration?: number
}

export interface ToastContextValue {
  /** Shows a toast and returns its id. */
  show: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

interface ToastItem extends ToastOptions {
  id: number
  tone: ToastTone
}

const MAX_TOASTS = 4
const ToastContext = createContext<ToastContextValue | null>(null)

const ICONS = { info: IconInfoCircle, success: IconCircleCheck, error: IconAlertTriangle }

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const { t } = useI18n()
  const [paused, setPaused] = useState(false)
  const duration = toast.duration ?? (toast.tone === 'error' ? 8000 : 5000)

  useEffect(() => {
    if (paused || duration <= 0) return
    const timer = window.setTimeout(() => onDismiss(toast.id), duration)
    return () => window.clearTimeout(timer)
  }, [paused, duration, onDismiss, toast.id])

  const Icon = ICONS[toast.tone]
  const action = toast.action
  return (
    <motion.div
      layout
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={styles.toast}
      data-tone={toast.tone}
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className={styles.icon} size={20} stroke={2} aria-hidden="true" />
      <p className={styles.message}>{toast.message}</p>
      {action &&
        (action.to ? (
          <Link
            className={styles.action}
            to={action.to}
            onClick={() => {
              action.onPress?.()
              onDismiss(toast.id)
            }}
          >
            {action.label}
          </Link>
        ) : (
          <Button
            className={styles.action}
            onPress={() => {
              action.onPress?.()
              onDismiss(toast.id)
            }}
          >
            {action.label}
          </Button>
        ))}
      <Button className={styles.close} aria-label={t('components.toast.dismiss')} onPress={() => onDismiss(toast.id)}>
        <IconX size={16} stroke={2.2} aria-hidden="true" />
      </Button>
    </motion.div>
  )
}

/** Toast queue + region (top centre, below the header). Must render inside the router. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current
    nextId.current += 1
    setToasts((current) => [...current, { ...options, tone: options.tone ?? 'info', id }].slice(-MAX_TOASTS))
    return id
  }, [])

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss])
  return (
    <ToastContext value={value}>
      {children}
      {/* Portalled to <body> as a react-aria "top layer": stays above (and usable / announced
          while) modals are open, instead of sitting under their overlay inside #root. */}
      {createPortal(
        <section className={styles.region} aria-label={t('shell.notifications')} data-react-aria-top-layer="true">
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </AnimatePresence>
        </section>,
        document.body,
      )}
    </ToastContext>
  )
}

export function useToast(): ToastContextValue {
  const context = use(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
