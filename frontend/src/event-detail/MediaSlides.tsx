import { IconLivePhoto, IconLoader2, IconVideoOff } from '@tabler/icons-react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { ImageOut } from '../api/schema.gen'
import { useI18n } from '../i18n'
import styles from './Carousel.module.css'

/** How a carousel slide shows its item. */
export type SlideKind = 'photo' | 'video' | 'live'

/** A video; a Live Photo whose motion is ready and shown; otherwise a still photo. */
export function slideKind(image: ImageOut): SlideKind {
  if (image.kind === 'video') return 'video'
  return image.live && image.video_status === 'ready' && image.video_url ? 'live' : 'photo'
}

/** A press this long (ms) on a Live Photo plays it; moving more than this (px) is a swipe instead. */
export const HOLD_MS = 300
const HOLD_SLOP_PX = 10

/**
 * Plays `video` from the start with sound, or muted when the browser refuses sound without a
 * recent gesture (autoplay policies); nothing happens when it refuses to play at all.
 */
export async function playFromStart(video: HTMLVideoElement): Promise<void> {
  video.currentTime = 0
  video.muted = false
  try {
    await video.play()
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') return
    video.muted = true
    try {
      await video.play()
    } catch {
      // Autoplay is blocked altogether: the photo stays still.
    }
  }
}

interface SlideProps {
  image: ImageOut
  /** The current slide. */
  active: boolean
  /** At most one slide away from the current one (loads eagerly). */
  near: boolean
}

/**
 * A video: the browser's player (sound, seeking, full screen) over its poster frame; it pauses
 * when another slide is shown. While the server converts it, the poster and a note instead.
 */
export function VideoSlide({ image, active, near }: SlideProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!active) ref.current?.pause()
  }, [active])

  if (image.video_status !== 'ready' || !image.video_url) {
    const processing = image.video_status === 'processing'
    const Icon = processing ? IconLoader2 : IconVideoOff
    return (
      <>
        <img
          className={styles.photo}
          data-loaded
          src={image.display_url}
          alt={image.name}
          width={image.width}
          height={image.height}
          loading={near ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
        />
        <p className={styles.videoState}>
          <Icon size={18} aria-hidden="true" className={processing ? styles.spinning : undefined} />
          {processing ? t('detail.carousel.videoProcessing') : t('detail.carousel.videoFailed')}
        </p>
      </>
    )
  }

  return (
    <video
      ref={ref}
      className={styles.video}
      src={image.video_url}
      poster={image.display_url}
      controls
      playsInline
      preload={near ? 'metadata' : 'none'}
      aria-label={image.name}
      width={image.width}
      height={image.height}
    />
  )
}

interface LivePhotoProps extends SlideProps {
  /** The still photo (with the carousel's loading and error states). */
  children: ReactNode
  /**
   * Covered by another layer that shows it (the full-screen viewer over the card): the clip stops,
   * and neither becoming the current slide meanwhile nor being uncovered plays it.
   */
  paused?: boolean
}

/**
 * A Live Photo: the still, with its clip playing over it once each time it becomes the current
 * slide (not with reduced motion, nor while `paused`), and again on hover over the LIVE badge, on
 * pressing it or while the photo is held down; the still comes back when the clip ends or the press
 * is released.
 */
export function LivePhoto({ image, active, near, paused = false, children }: LivePhotoProps) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const ref = useRef<HTMLVideoElement>(null)
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null)
  const holding = useRef(false)
  // This press played the clip: the click that may end it is not a tap on the photo.
  const held = useRef(false)
  const [playing, setPlaying] = useState(false)
  // Read when the slide becomes current: uncovering it alone must not play it.
  const pausedRef = useRef(paused)
  useLayoutEffect(() => {
    pausedRef.current = paused
  })

  const play = useCallback(() => {
    const video = ref.current
    if (video) void playFromStart(video)
  }, [])

  // Pausing hides the clip again (`onPause`).
  const stop = useCallback(() => ref.current?.pause(), [])

  useEffect(() => {
    if (!active) {
      stop()
      return
    }
    if (!reduceMotion && !pausedRef.current) play()
  }, [active, reduceMotion, play, stop])

  useEffect(() => {
    if (paused) stop()
  }, [paused, stop])

  const cancelHold = useCallback(() => {
    if (!hold.current) return
    window.clearTimeout(hold.current.timer)
    hold.current = null
  }, [])

  useEffect(() => cancelHold, [cancelHold])

  const release = () => {
    cancelHold()
    if (!holding.current) return
    holding.current = false
    stop()
  }

  return (
    <div
      className={styles.live}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        held.current = false
        cancelHold()
        const timer = window.setTimeout(() => {
          hold.current = null
          holding.current = true
          held.current = true
          play()
        }, HOLD_MS)
        hold.current = { timer, x: event.clientX, y: event.clientY }
      }}
      onPointerMove={(event) => {
        const start = hold.current
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > HOLD_SLOP_PX) cancelHold()
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onClickCapture={(event) => {
        if (!held.current) return
        held.current = false
        event.preventDefault()
      }}
      // A long press would open the browser's image menu instead.
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
      <video
        ref={ref}
        className={styles.motion}
        data-playing={playing || undefined}
        src={image.video_url ?? undefined}
        playsInline
        preload={near ? 'auto' : 'none'}
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        className={styles.liveBadge}
        data-playing={playing || undefined}
        aria-label={t('detail.carousel.playLive', { name: image.name })}
        onPointerDown={(event: ReactPointerEvent) => event.stopPropagation()}
        onPointerEnter={(event: ReactPointerEvent) => {
          if (event.pointerType === 'mouse') play()
        }}
        onClick={play}
      >
        <IconLivePhoto size={16} stroke={2} aria-hidden="true" />
        <span aria-hidden="true">{t('detail.carousel.liveTag')}</span>
      </button>
    </div>
  )
}
