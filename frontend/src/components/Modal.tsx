import { IconX } from '@tabler/icons-react'
import { AnimatePresence, motion, type TargetAndTransition, type Transition } from 'motion/react'
import { useRef, type ReactNode } from 'react'
import { Dialog, Heading, Modal as AriaModal, ModalOverlay } from 'react-aria-components'
import { useI18n } from '../i18n'
import { useIsMobile } from '../utils/useMediaQuery'
import { useSwipeToClose } from '../utils/useSwipeToClose'
import { IconButton } from './IconButton'
import styles from './Modal.module.css'
import { cx } from './utils'

const MotionOverlay = motion.create(ModalOverlay)
const MotionModal = motion.create(AriaModal)

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

/** Screen rect (e.g. `element.getBoundingClientRect()`) the modal grows from and shrinks back to. */
export interface OriginRect {
  x: number
  y: number
  width: number
  height: number
}

type RenderChildren = ReactNode | ((close: () => void) => ReactNode)

export interface ModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** Visible title (dialog's accessible name). Without it pass `aria-label`. */
  title?: ReactNode
  'aria-label'?: string
  /** sm 420 · md 560 · lg 760 · xl min(1040px, 92vw). Default `md`. */
  size?: ModalSize
  /** Below 768 px the modal covers the whole screen and slides up. */
  fullScreenOnMobile?: boolean
  /**
   * Full screen on a phone (`fullScreenOnMobile`): pulling the panel down from the top of its
   * content closes it, like the close button (it follows the finger, uncovering the page).
   */
  swipeToClose?: boolean
  /** Close on backdrop click (default true; Esc always closes unless `isKeyboardDismissDisabled`). */
  isDismissable?: boolean
  isKeyboardDismissDisabled?: boolean
  hideCloseButton?: boolean
  /** Remove the body padding (media-first layouts). */
  bleed?: boolean
  /** No outline around the panel (media-first cards). */
  borderless?: boolean
  footer?: RenderChildren
  /** Animate from/to this rect (falls back to a soft scale/fade). */
  originRect?: OriginRect | null
  role?: 'dialog' | 'alertdialog'
  /** Extra class for the modal panel. */
  className?: string
  children: RenderChildren
}

const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }

function hiddenState(originRect: OriginRect | null | undefined, slideUp: boolean): TargetAndTransition {
  if (slideUp) return { y: '100%', opacity: 1 }
  if (originRect && typeof window !== 'undefined') {
    return {
      opacity: 0,
      scale: 0.2,
      x: originRect.x + originRect.width / 2 - window.innerWidth / 2,
      y: originRect.y + originRect.height / 2 - window.innerHeight / 2,
    }
  }
  return { opacity: 0, scale: 0.96, y: 12 }
}

function render(content: RenderChildren | undefined, close: () => void): ReactNode {
  return typeof content === 'function' ? content(close) : content
}

/**
 * Accessible modal dialog (react-aria: focus trap, Esc, scroll lock, focus restore) with Motion
 * enter/exit. Controlled: render it always and toggle `isOpen`.
 */
export function Modal({
  isOpen,
  onOpenChange,
  title,
  'aria-label': ariaLabel,
  size = 'md',
  fullScreenOnMobile = false,
  swipeToClose = false,
  isDismissable = true,
  isKeyboardDismissDisabled = false,
  hideCloseButton = false,
  bleed = false,
  borderless = false,
  footer,
  originRect,
  role = 'dialog',
  className,
  children,
}: ModalProps) {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const fullScreen = fullScreenOnMobile && isMobile
  const hidden = hiddenState(originRect, fullScreen)
  const overlayRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Kept while the panel leaves, which it does from where the finger let go.
  const swipeable = swipeToClose && fullScreen
  useSwipeToClose(overlayRef, () => onOpenChange(false), { enabled: swipeable && isOpen, scrollerRef: bodyRef, exit: 'now' })
  const showHeader = Boolean(title) || !hideCloseButton
  // A single title slot rendered from the first frame keeps the dialog labelled even when the
  // visible title arrives later (e.g. after loading); without a title it holds ria-label.
  const heading =
    title || ariaLabel ? (
      <Heading slot="title" className={title ? styles.title : 'visually-hidden'}>
        {title ?? ariaLabel}
      </Heading>
    ) : null

  return (
    <AnimatePresence>
      {isOpen && (
        <MotionOverlay
          key="modal-overlay"
          ref={overlayRef}
          isOpen
          onOpenChange={onOpenChange}
          isDismissable={isDismissable}
          isKeyboardDismissDisabled={isKeyboardDismissDisabled}
          className={cx(styles.overlay, fullScreen && styles.overlayFull, swipeable && styles.swipeable)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          transition={{ duration: 0.2 }}
        >
          <MotionModal
            className={cx(styles.modal, styles[size], fullScreen && styles.fullScreen, borderless && styles.borderless, className)}
            initial={hidden}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ ...hidden, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={SPRING}
          >
            <Dialog role={role} className={styles.dialog}>
              {({ close }) => (
                <>
                  {showHeader ? (
                    <header className={cx(styles.header, !title && styles.headerFloating)}>
                      {heading}
                      {!hideCloseButton && (
                        <IconButton
                          label={t('components.modal.close')}
                          icon={IconX}
                          variant={title ? 'ghost' : 'overlay'}
                          tooltip={false}
                          onPress={close}
                          className={styles.close}
                        />
                      )}
                    </header>
                  ) : (
                    heading
                  )}
                  <div ref={bodyRef} className={cx(styles.body, bleed && styles.bleed)}>{render(children, close)}</div>
                  {footer && <footer className={styles.footer}>{render(footer, close)}</footer>}
                </>
              )}
            </Dialog>
          </MotionModal>
        </MotionOverlay>
      )}
    </AnimatePresence>
  )
}
