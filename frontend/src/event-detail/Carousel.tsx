import { IconChevronLeft, IconChevronRight, IconMaximize, IconPhotoOff } from '@tabler/icons-react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import type { ImageOut } from '../api/schema.gen'
import { IconButton } from '../components/IconButton'
import { cx } from '../components/utils'
import { useI18n } from '../i18n'
import styles from './Carousel.module.css'
import { dotWindow, ownsArrowKeys } from './detailUtils'
import { LivePhoto, VideoSlide, slideKind } from './MediaSlides'

/** Imperative control of a carousel (e.g. follow the photo last seen full screen). */
export interface CarouselHandle {
  /** Jumps to `index` without animation. */
  show: (index: number) => void
}

export interface CarouselProps {
  /** Slides in display order (cover first); at least one image. */
  images: readonly ImageOut[]
  /** Accessible name, e.g. "Fotos de «Primeros pasos»". */
  label: string
  /**
   * React to ←/→ anywhere on the page (the carousel lives in the topmost dialog). Keys aimed at
   * text fields, lists, sliders… or at another layer are ignored. Default true.
   */
  globalKeys?: boolean
  /** `card` (detail card stage) or `viewer` (full-screen photo viewer: black, edge to edge). */
  variant?: 'card' | 'viewer'
  /** Slide shown first (default 0). */
  initialIndex?: number
  /** The current slide changed (swipe, arrows, dots, keys). */
  onIndexChange?: (index: number) => void
  /**
   * Offers the photos full screen: a tap on a photo, or the "full screen" button, calls it with
   * the current slide.
   */
  onExpand?: (index: number) => void
  /**
   * Covered by the full-screen viewer, which shows the same photos (the card follows it underneath):
   * Live Photos stay still meanwhile, so no clip plays twice, nor again once uncovered.
   */
  paused?: boolean
  className?: string
  ref?: Ref<CarouselHandle>
}

type Arrow = 'previous' | 'next'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r]/g, (char) => encodeURIComponent(char))}")`
}

function withId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return set.has(id) ? set : new Set(set).add(id)
}

/**
 * Photo and video carousel of the event detail card: native scroll-snap swipe, arrow buttons (on
 * hover), pagination dots + "2 / 5" counter and ←/→ keys. Each slide shows the photo `contain`ed
 * over a blurred, scaled copy of itself, on the image's dominant colour while it loads; slides more
 * than one step away from the current one load lazily. Videos play in the browser's player and
 * Live Photos move over their still (see `MediaSlides`). With `onExpand` (phones) a tap on a photo,
 * or the "full screen" button, opens it full screen; `variant="viewer"` is that full-screen stage.
 */
export function Carousel({
  images,
  label,
  globalKeys = true,
  variant = 'card',
  initialIndex = 0,
  onIndexChange,
  onExpand,
  paused = false,
  className,
  ref,
}: CarouselProps) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const count = images.length
  const multiple = count > 1
  const first = clamp(initialIndex, 0, Math.max(0, count - 1))
  const scrollerRef = useRef<HTMLDivElement>(null)
  const previousRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [index, setIndex] = useState(first)
  const [interacted, setInteracted] = useState(false)
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set())
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  // Mirrors `index` for the event listeners (written only where the index changes).
  const indexRef = useRef(first)
  // Slide a programmatic smooth scroll is heading to: positions passed on the way are ignored.
  const targetRef = useRef<number | null>(null)
  const releaseTimerRef = useRef(0)
  const pendingFocusRef = useRef<Arrow | null>(null)
  const callbacksRef = useRef({ onIndexChange, onExpand })
  useLayoutEffect(() => {
    callbacksRef.current = { onIndexChange, onExpand }
  })

  const commit = useCallback((next: number) => {
    const changed = next !== indexRef.current
    indexRef.current = next
    setIndex(next)
    setInteracted(true)
    if (changed) callbacksRef.current.onIndexChange?.(next)
  }, [])

  const goTo = useCallback(
    (target: number, instant = false) => {
      if (count < 2) return
      const next = clamp(target, 0, count - 1)
      // The arrow that disappears at either end hands its keyboard focus to the other one.
      const focused = document.activeElement
      if (next === 0 && focused === previousRef.current) pendingFocusRef.current = 'next'
      else if (next === count - 1 && focused === nextRef.current) pendingFocusRef.current = 'previous'
      commit(next)
      const scroller = scrollerRef.current
      if (!scroller) return
      targetRef.current = next
      window.clearTimeout(releaseTimerRef.current)
      // Safety net for browsers without `scrollend`.
      releaseTimerRef.current = window.setTimeout(() => {
        targetRef.current = null
      }, 1000)
      scroller.scrollTo({ left: next * scroller.clientWidth, behavior: instant || reduceMotion ? 'auto' : 'smooth' })
    },
    [count, commit, reduceMotion],
  )

  useImperativeHandle(ref, () => ({ show: (target) => goTo(target, true) }), [goTo])

  // Opens on the requested slide (no animation).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller && indexRef.current > 0) scroller.scrollLeft = indexRef.current * scroller.clientWidth
  }, [])

  // A tap on a photo (touch or mouse) offers it full screen; swipes never produce a click. Videos
  // keep their own player (full screen included), buttons their own action, and the click that
  // ends holding a Live Photo down is not a tap (it arrives cancelled).
  const expandable = onExpand !== undefined
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !expandable) return
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('button, a, video, [data-kind="video"]')) return
      callbacksRef.current.onExpand?.(indexRef.current)
    }
    scroller.addEventListener('click', onClick)
    return () => scroller.removeEventListener('click', onClick)
  }, [expandable])

  // Swipes (touch, trackpad, scrollbar) move the current slide.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || count < 2) return
    let frame = 0
    const sync = () => {
      frame = 0
      const width = scroller.clientWidth
      if (width <= 0) return
      const position = scroller.scrollLeft / width
      const target = targetRef.current
      if (target !== null) {
        if (Math.abs(position - target) > 0.02) return
        targetRef.current = null
      }
      const next = clamp(Math.round(position), 0, count - 1)
      if (next !== indexRef.current) commit(next)
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(sync)
    }
    const onScrollEnd = () => {
      targetRef.current = null
      sync()
    }
    // A finger, wheel or pointer takes over from a programmatic scroll.
    const release = () => {
      targetRef.current = null
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('scrollend', onScrollEnd)
    scroller.addEventListener('touchstart', release, { passive: true })
    scroller.addEventListener('wheel', release, { passive: true })
    scroller.addEventListener('pointerdown', release)
    return () => {
      window.cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('scrollend', onScrollEnd)
      scroller.removeEventListener('touchstart', release)
      scroller.removeEventListener('wheel', release)
      scroller.removeEventListener('pointerdown', release)
    }
  }, [count, commit])

  useEffect(() => () => window.clearTimeout(releaseTimerRef.current), [])

  // ←/→ anywhere in the card; Home/End while the photo strip itself has focus.
  useEffect(() => {
    if (!globalKeys || count < 2) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const scroller = scrollerRef.current
      if (!scroller) return
      const onStrip = event.target === scroller
      let next: number
      if (event.key === 'ArrowLeft') next = indexRef.current - 1
      else if (event.key === 'ArrowRight') next = indexRef.current + 1
      else if (onStrip && event.key === 'Home') next = 0
      else if (onStrip && event.key === 'End') next = count - 1
      else return
      if (ownsArrowKeys(event.target)) return
      // Keys typed in another layer (a popover, another dialog) are not for us.
      const layer = scroller.closest('[role="dialog"], [role="alertdialog"]')
      const target = event.target instanceof Node ? event.target : null
      if (layer && target && target !== document.body && !layer.contains(target)) return
      event.preventDefault()
      goTo(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [globalKeys, count, goTo])

  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    ;(pending === 'previous' ? previousRef : nextRef).current?.focus()
  }, [index])

  const current = images[clamp(index, 0, count - 1)]
  const { start, end } = dotWindow(count, index)
  const dots = Array.from({ length: end - start }, (_, offset) => start + offset)

  return (
    <div
      className={cx(styles.carousel, variant === 'viewer' && styles.viewer, expandable && styles.expandable, className)}
      data-multiple={multiple || undefined}
    >
      <div
        ref={scrollerRef}
        className={styles.track}
        role="region"
        aria-roledescription={t('detail.carousel.roleDescription')}
        aria-label={label}
        // Scrollable strips must be reachable with the keyboard (←/→, Home/End once focused).
        tabIndex={multiple ? 0 : undefined}
      >
        {images.map((image, slide) => {
          const near = Math.abs(slide - index) <= 1
          const isLoaded = loaded.has(image.id)
          const kind = slideKind(image)
          // The file name is for assistive tech only (alt / label, no tooltip).
          const photo = failed.has(image.id) ? (
            <div className={styles.broken} role="img" aria-label={image.name}>
              <IconPhotoOff size={36} stroke={1.6} aria-hidden="true" />
              <span aria-hidden="true">{t('detail.carousel.imageError')}</span>
            </div>
          ) : (
            <img
              className={styles.photo}
              data-loaded={isLoaded || undefined}
              src={image.display_url}
              alt={image.name}
              width={image.width}
              height={image.height}
              loading={near ? 'eager' : 'lazy'}
              fetchPriority={slide === 0 ? 'high' : undefined}
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded((set) => withId(set, image.id))}
              onError={() => setFailed((set) => withId(set, image.id))}
            />
          )
          return (
            <div
              key={image.id}
              className={styles.slide}
              // The dominant colour stands in while the photo loads (the viewer stays black).
              style={variant === 'card' ? { backgroundColor: image.dominant_color } : undefined}
              role={multiple ? 'group' : undefined}
              aria-roledescription={
                multiple
                  ? kind === 'video'
                    ? t('detail.carousel.videoRoleDescription')
                    : t('detail.carousel.slideRoleDescription')
                  : undefined
              }
              aria-label={multiple ? t('detail.carousel.slideLabel', { current: slide + 1, total: count }) : undefined}
              data-kind={kind}
            >
              <div
                className={styles.backdrop}
                style={near || isLoaded ? { backgroundImage: cssUrl(image.thumb_url) } : undefined}
                aria-hidden="true"
              />
              {kind === 'video' ? (
                <VideoSlide image={image} active={slide === index} near={near} />
              ) : kind === 'live' ? (
                <LivePhoto image={image} active={slide === index} near={near} paused={paused}>
                  {photo}
                </LivePhoto>
              ) : (
                photo
              )}
            </div>
          )
        })}
      </div>

      {multiple && (
        <>
          <span className={styles.counter} aria-hidden="true">
            {index + 1} / {count}
          </span>
          {index > 0 && (
            <IconButton
              ref={previousRef}
              className={cx(styles.arrow, styles.previous)}
              label={t('detail.carousel.previous')}
              icon={IconChevronLeft}
              variant="overlay"
              size="lg"
              tooltip={false}
              onPress={() => goTo(indexRef.current - 1)}
            />
          )}
          {index < count - 1 && (
            <IconButton
              ref={nextRef}
              className={cx(styles.arrow, styles.next)}
              label={t('detail.carousel.next')}
              icon={IconChevronRight}
              variant="overlay"
              size="lg"
              tooltip={false}
              onPress={() => goTo(indexRef.current + 1)}
            />
          )}
          <div className={styles.dots} role="group" aria-label={t('detail.carousel.pagination')}>
            {dots.map((slide) => (
              <button
                key={images[slide].id}
                type="button"
                className={styles.dot}
                data-active={slide === index || undefined}
                data-small={(slide === start && start > 0) || (slide === end - 1 && end < count) || undefined}
                aria-label={t('detail.carousel.goTo', { current: slide + 1, total: count })}
                aria-current={slide === index ? 'true' : undefined}
                onClick={() => goTo(slide)}
              />
            ))}
          </div>
        </>
      )}

      {/* Photos only: a video's own player has its full-screen button. */}
      {expandable && slideKind(current) !== 'video' && (
        <IconButton
          className={styles.expand}
          label={t('detail.viewer.open')}
          icon={IconMaximize}
          variant="overlay"
          tooltip={false}
          onPress={() => callbacksRef.current.onExpand?.(indexRef.current)}
        />
      )}

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {multiple && interacted
          ? t('detail.carousel.status', { current: index + 1, total: count, name: current.name })
          : ''}
      </p>
    </div>
  )
}
