import { IconX } from '@tabler/icons-react'
import { useCallback, useRef, useState } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import type { ImageOut } from '../api/schema.gen'
import { IconButton } from '../components/IconButton'
import { useI18n } from '../i18n'
import { useSwipeToClose } from '../utils/useSwipeToClose'
import { Carousel } from './Carousel'
import styles from './PhotoViewer.module.css'

export interface PhotoViewerProps {
  /** Photos and videos in display order (cover first). */
  images: readonly ImageOut[]
  /** Event title, for the accessible names. */
  title: string
  /** Photo shown first. */
  initialIndex: number
  /** The photo on screen changed (swipe, dots, keys). */
  onIndexChange: (index: number) => void
  /** ✕, Esc or a swipe down. */
  onClose: () => void
}

/**
 * Full-screen viewer (opened from the detail card on phones): the event's photos (and videos) on a
 * black stage, edge to edge; swipe (or ←/→, the dots) between them and leave with ✕, Esc or by
 * swiping the photo down (it follows the finger while the card shows through).
 */
export function PhotoViewer({ images, title, initialIndex, onIndexChange, onClose }: PhotoViewerProps) {
  const { t } = useI18n()
  const [first] = useState(initialIndex)
  const dialogRef = useRef<HTMLElement>(null)
  // ✕ or Esc while a swipe down glides away must not go back twice.
  const closedRef = useRef(false)
  const close = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    onClose()
  }, [onClose])
  useSwipeToClose(dialogRef, close)
  const withVideos = images.some((image) => image.kind === 'video')
  return (
    <ModalOverlay
      isOpen
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      className={styles.overlay}
    >
      <Modal className={styles.modal}>
        <Dialog
          ref={dialogRef}
          className={styles.dialog}
          aria-label={t(withVideos ? 'detail.viewer.mediaLabel' : 'detail.viewer.label', { title })}
        >
          <Carousel
            images={images}
            label={t(withVideos ? 'detail.carousel.mediaLabel' : 'detail.carousel.label', { title })}
            variant="viewer"
            initialIndex={first}
            onIndexChange={onIndexChange}
          />
          {/* In a box of its own, which fades while a photo is swiped down. */}
          <div className={styles.close}>
            <IconButton label={t('detail.viewer.close')} icon={IconX} variant="overlay" tooltip={false} onPress={close} />
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
