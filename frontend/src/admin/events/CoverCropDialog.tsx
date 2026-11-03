import { IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowUp, IconFocusCentered } from '@tabler/icons-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ImageCrop, ImageOut } from '../../api/schema.gen'
import { Button } from '../../components/Button'
import { IconButton } from '../../components/IconButton'
import { Modal } from '../../components/Modal'
import { Slider } from '../../components/Switch'
import { useI18n } from '../../i18n'
import { CENTRED_CROP, MAX_CROP_ZOOM, clampCrop, framedImageStyle, normalizeCrop, panCrop, zoomCrop } from '../../utils/crop'
import styles from './CoverCropDialog.module.css'

/** Share of the visible square one arrow press moves the photo. */
const NUDGE = 0.05
/** Zoom change per pixel of wheel delta (exponential, so in and out feel the same). */
const WHEEL_ZOOM = 0.0015

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

interface CropStageProps {
  image: ImageOut
  crop: ImageCrop
  onChange: (crop: ImageCrop) => void
  label: string
  describedBy: string
}

/**
 * The cover inside the circle it fills on the timeline: drag to move it, wheel or pinch to zoom
 * (around the pointer). Keyboard users have the zoom slider and the arrow buttons.
 */
function CropStage({ image, crop, onChange, label, describedBy }: CropStageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ crop, onChange })
  const [dragging, setDragging] = useState(false)
  useLayoutEffect(() => {
    latest.current = { crop, onChange }
  })

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const element: HTMLDivElement = stage
    const pointers = new Map<number, { x: number; y: number }>()

    function apply(next: ImageCrop) {
      latest.current.crop = next
      latest.current.onChange(next)
    }

    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      event.preventDefault()
      element.setPointerCapture?.(event.pointerId)
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      setDragging(true)
    }

    function onPointerMove(event: PointerEvent) {
      const previous = pointers.get(event.pointerId)
      if (!previous) return
      const point = { x: event.clientX, y: event.clientY }
      const rect = element.getBoundingClientRect()
      const current = latest.current.crop
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]
      if (!other) {
        apply(panCrop(current, point.x - previous.x, point.y - previous.y, rect.width, image))
      } else {
        // Pinch: zoom by the change of distance between the fingers, around their midpoint.
        const before = Math.hypot(previous.x - other.x, previous.y - other.y)
        const after = Math.hypot(point.x - other.x, point.y - other.y)
        if (before > 0) {
          const anchor = {
            x: clamp01(((point.x + other.x) / 2 - rect.left) / rect.width),
            y: clamp01(((point.y + other.y) / 2 - rect.top) / rect.height),
          }
          apply(zoomCrop(current, current.zoom * (after / before), image, anchor))
        }
      }
      pointers.set(event.pointerId, point)
    }

    function onPointerEnd(event: PointerEvent) {
      pointers.delete(event.pointerId)
      if (pointers.size === 0) setDragging(false)
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const current = latest.current.crop
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * rect.height : event.deltaY
      const anchor = { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) }
      apply(zoomCrop(current, current.zoom * Math.exp(-delta * WHEEL_ZOOM), image, anchor))
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', onPointerEnd)
    element.addEventListener('pointercancel', onPointerEnd)
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerEnd)
      element.removeEventListener('pointercancel', onPointerEnd)
      element.removeEventListener('wheel', onWheel)
    }
  }, [image])

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      style={{ backgroundColor: image.dominant_color }}
      data-dragging={dragging || undefined}
      data-testid="crop-stage"
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
    >
      <img className={styles.photo} src={image.display_url} alt="" draggable={false} style={framedImageStyle(crop, image)} />
      <span className={styles.mask} aria-hidden="true" />
    </div>
  )
}

export interface CoverCropDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** The uploaded cover. */
  image: ImageOut
  /** Framing being edited (possibly unsaved); null = the centred square. */
  crop: ImageCrop | null
  /** Receives the framing as the server stores it (null when centred). */
  onApply: (crop: ImageCrop | null) => void
}

/** "Encuadre de la portada": zoom and move the cover inside the timeline circle. */
export function CoverCropDialog({ isOpen, onOpenChange, image, crop, onApply }: CoverCropDialogProps) {
  const { t } = useI18n()
  const helpId = useId()
  const [draft, setDraft] = useState<ImageCrop>(() => clampCrop(crop ?? CENTRED_CROP, image))
  const [wasOpen, setWasOpen] = useState(isOpen)
  // Every opening starts from the current framing.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setDraft(clampCrop(crop ?? CENTRED_CROP, image))
  }
  const centred = normalizeCrop(draft, image) === null

  // Arrow buttons move the photo like a drag would (the visible square goes the other way).
  const nudge = (dx: number, dy: number) => setDraft((current) => panCrop(current, dx * NUDGE, dy * NUDGE, 1, image))

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={t('adminEvents.crop.title')}
      size="md"
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" icon={IconFocusCentered} isDisabled={centred} onPress={() => setDraft(CENTRED_CROP)}>
            {t('adminEvents.crop.reset')}
          </Button>
          <span className={styles.spacer} />
          <Button variant="ghost" onPress={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onPress={() => {
              onApply(normalizeCrop(draft, image))
              onOpenChange(false)
            }}
          >
            {t('adminEvents.crop.apply')}
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        <p id={helpId} className={styles.help}>
          {t('adminEvents.crop.help')}
        </p>
        <CropStage image={image} crop={draft} onChange={setDraft} label={t('adminEvents.crop.stage', { name: image.name })} describedBy={helpId} />
        <div className={styles.controls}>
          <Slider
            label={t('adminEvents.crop.zoom')}
            minValue={1}
            maxValue={MAX_CROP_ZOOM}
            step={0.01}
            value={draft.zoom}
            onChange={(zoom) => setDraft((current) => zoomCrop(current, zoom, image))}
            formatOptions={{ style: 'percent', maximumFractionDigits: 0 }}
            className={styles.zoom}
          />
          <div className={styles.nudges} role="group" aria-label={t('adminEvents.crop.move')}>
            <IconButton size="sm" icon={IconArrowLeft} label={t('adminEvents.crop.left')} onPress={() => nudge(-1, 0)} />
            <IconButton size="sm" icon={IconArrowUp} label={t('adminEvents.crop.up')} onPress={() => nudge(0, -1)} />
            <IconButton size="sm" icon={IconArrowDown} label={t('adminEvents.crop.down')} onPress={() => nudge(0, 1)} />
            <IconButton size="sm" icon={IconArrowRight} label={t('adminEvents.crop.right')} onPress={() => nudge(1, 0)} />
          </div>
        </div>
      </div>
    </Modal>
  )
}
