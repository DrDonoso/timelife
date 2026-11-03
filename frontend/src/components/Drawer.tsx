import { IconX } from '@tabler/icons-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Dialog, Heading, Modal as AriaModal, ModalOverlay } from 'react-aria-components'
import { useI18n } from '../i18n'
import styles from './Drawer.module.css'
import { IconButton } from './IconButton'
import { cx } from './utils'

const MotionOverlay = motion.create(ModalOverlay)
const MotionModal = motion.create(AriaModal)

export interface DrawerProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** Edge the panel slides from (default `left`). */
  side?: 'left' | 'right'
  title?: ReactNode
  /** Accessible name when there is no visible title. */
  'aria-label'?: string
  /** Panel width (CSS length, default `min(320px, 86vw)`). */
  width?: string
  className?: string
  children: ReactNode | ((close: () => void) => ReactNode)
}

/** Full-height side panel with backdrop (modal semantics: focus trap, Esc, scroll lock). */
export function Drawer({
  isOpen,
  onOpenChange,
  side = 'left',
  title,
  'aria-label': ariaLabel,
  width = 'min(320px, 86vw)',
  className,
  children,
}: DrawerProps) {
  const { t } = useI18n()
  const offscreen = side === 'left' ? '-100%' : '100%'
  return (
    <AnimatePresence>
      {isOpen && (
        <MotionOverlay
          key="drawer-overlay"
          isOpen
          isDismissable
          onOpenChange={onOpenChange}
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <MotionModal
            className={cx(styles.drawer, styles[side], className)}
            style={{ width }}
            initial={{ x: offscreen }}
            animate={{ x: 0 }}
            exit={{ x: offscreen, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
          >
            <Dialog className={styles.dialog}>
              {({ close }) => (
                <>
                  <header className={styles.header}>
                    {(title || ariaLabel) && (
                      <Heading slot="title" className={styles.title} aria-label={ariaLabel}>
                        {title ?? <span className="visually-hidden">{ariaLabel}</span>}
                      </Heading>
                    )}
                    <IconButton
                      label={t('components.modal.close')}
                      icon={IconX}
                      onPress={close}
                      tooltip={false}
                      className={styles.close}
                    />
                  </header>
                  <div className={styles.body}>{typeof children === 'function' ? children(close) : children}</div>
                </>
              )}
            </Dialog>
          </MotionModal>
        </MotionOverlay>
      )}
    </AnimatePresence>
  )
}
