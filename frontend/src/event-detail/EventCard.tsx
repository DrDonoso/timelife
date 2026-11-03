import { IconCalendarEvent, IconMapPin, IconPencil, IconSparkles, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react'
import { Focusable, Heading, TooltipTrigger } from 'react-aria-components'
import { useLocation, useNavigate } from 'react-router'
import { useCategories } from '../api/queries'
import type { CategoryOut, ChildOut, EventOut } from '../api/schema.gen'
import { Avatar } from '../components/Avatar'
import { CategoryPill } from '../components/CategoryPill'
import { IconButton } from '../components/IconButton'
import { Tooltip } from '../components/Tooltip'
import { cx } from '../components/utils'
import { useCurrentChild } from '../contexts/CurrentChildContext'
import { CategoryIcon } from '../icons/CategoryIcon'
import { useI18n } from '../i18n'
import { useThemeColors } from '../theme/useThemeColors'
import { categoriesById, pickCategories } from '../utils/categories'
import { NEUTRAL_COLOR, ensureContrast, shiftLightness } from '../utils/color'
import { useIsMobile } from '../utils/useMediaQuery'
import { Carousel, type CarouselHandle } from './Carousel'
import { orderImages, readPhotoIndex, withPhotoIndex } from './detailUtils'
import styles from './EventCard.module.css'
import { PhotoViewer } from './PhotoViewer'

export interface DetailToolbarProps {
  onClose: () => void
  /** Shows the pencil button (admins only). */
  onEdit?: () => void
  /** Hover/focus on the pencil: a good moment to preload the editor. */
  onEditIntent?: () => void
  editButtonRef?: Ref<HTMLButtonElement>
  actionsRef?: Ref<HTMLDivElement>
  /** `overlay` (dark glass) over photos and colour headers; `surface` over the plain card. */
  tone?: 'overlay' | 'surface'
}

/** Close (and edit) buttons floating at the card's top-right corner, pinned while it scrolls. */
export function DetailToolbar({
  onClose,
  onEdit,
  onEditIntent,
  editButtonRef,
  actionsRef,
  tone = 'overlay',
}: DetailToolbarProps) {
  const { t } = useI18n()
  const variant = tone === 'overlay' ? 'overlay' : 'secondary'
  const className = cx(styles.toolButton, tone === 'surface' && styles.toolButtonSolid)
  return (
    <div className={styles.toolbar}>
      <div ref={actionsRef} className={styles.actions}>
        {onEdit && (
          <IconButton
            ref={editButtonRef}
            label={t('detail.edit')}
            icon={IconPencil}
            variant={variant}
            className={className}
            onPress={onEdit}
            onHoverStart={onEditIntent}
            onFocus={onEditIntent}
          />
        )}
        <IconButton label={t('detail.close')} icon={IconX} variant={variant} className={className} onPress={onClose} />
      </div>
    </div>
  )
}

/** Header for events without photos: gradient in the primary category colour (adapted to the palette) + its large icon. */
function FallbackHeader({ category }: { category: CategoryOut | null }) {
  const { adapt } = useThemeColors()
  const color = adapt(category?.color ?? NEUTRAL_COLOR)
  const style = useMemo(() => {
    // White icon on top: keep at least 3:1 (large graphics) against the base colour.
    const base = ensureContrast(color, '#ffffff', 3)
    return {
      '--fallback-base': base,
      '--fallback-light': shiftLightness(base, 0.12),
      '--fallback-deep': shiftLightness(base, -0.1),
    } as CSSProperties
  }, [color])
  return (
    <div className={styles.fallback} style={style} aria-hidden="true">
      <span className={styles.fallbackIcon}>
        {category ? <CategoryIcon icon={category.icon} size={68} stroke={1.6} /> : <IconSparkles size={68} stroke={1.6} />}
      </span>
    </div>
  )
}

/** Small avatars of the children of the event (shared ones, or any on the family timeline); the name shows on hover / keyboard focus. */
function SharedChildren({ people }: { people: readonly ChildOut[] }) {
  const { t } = useI18n()
  return (
    <ul className={styles.children} aria-label={t('detail.children')}>
      {people.map((child) => (
        <li key={child.id}>
          <TooltipTrigger delay={250} closeDelay={60}>
            <Focusable>
              <span className={styles.child} role="img" aria-label={child.name}>
                <Avatar name={child.name} image={child.avatar} size="sm" decorative />
              </span>
            </Focusable>
            <Tooltip placement="top">{child.name}</Tooltip>
          </TooltipTrigger>
        </li>
      ))}
    </ul>
  )
}

export interface EventCardProps {
  event: EventOut
  onClose: () => void
  /** Present for admins: switches the card to the editor. */
  onEdit?: () => void
  onEditIntent?: () => void
  editButtonRef?: Ref<HTMLButtonElement>
}

/** The event detail card: photos (or a colour header), category pills and the event data. */
export function EventCard({ event, onClose, onEdit, onEditIntent, editButtonRef }: EventCardProps) {
  const { t, formatDate } = useI18n()
  const categoriesQuery = useCategories()
  const { children, isAll } = useCurrentChild()
  const isMobile = useIsMobile()
  const location = useLocation()
  const navigate = useNavigate()
  const mediaRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const carouselRef = useRef<CarouselHandle>(null)
  const [overMedia, setOverMedia] = useState(true)
  const categories = useMemo(
    () => pickCategories(event.category_ids, categoriesById(categoriesQuery.data)),
    [event.category_ids, categoriesQuery.data],
  )
  const images = useMemo(() => orderImages(event.images, event.cover_image_id), [event.images, event.cover_image_id])
  // Shared milestones show who they belong to; on the family timeline every milestone does.
  const sharedWith = useMemo(
    () =>
      event.child_ids.length > 1 || isAll
        ? event.child_ids.flatMap((id) => children.filter((child) => child.id === id))
        : [],
    [event.child_ids, children, isAll],
  )
  const notes = event.notes.trim()
  const withVideos = images.some((image) => image.kind === 'video')
  const carouselLabel = t(withVideos ? 'detail.carousel.mediaLabel' : 'detail.carousel.label', { title: event.title })

  // Full-screen photos (phones): their own history entry, so the Back button leaves them first.
  const viewerIndex = readPhotoIndex(location.state, images.length)
  const lastViewed = useRef(0)
  const openViewer = useCallback(
    (index: number) => {
      lastViewed.current = index
      navigate({ pathname: location.pathname, search: location.search }, { state: withPhotoIndex(location.state, index) })
    },
    [navigate, location.pathname, location.search, location.state],
  )
  const closeViewer = useCallback(() => navigate(-1), [navigate])
  // Back from full screen (✕, Esc, a swipe down or the Back button): the card shows the photo seen last.
  const viewerOpen = viewerIndex !== null
  const wasViewerOpen = useRef(viewerOpen)
  useEffect(() => {
    if (wasViewerOpen.current && !viewerOpen) carouselRef.current?.show(lastViewed.current)
    wasViewerOpen.current = viewerOpen
  }, [viewerOpen])

  // The pinned buttons are dark glass over the photo and turn solid once text scrolls under them.
  useEffect(() => {
    const media = mediaRef.current
    const actions = actionsRef.current
    if (!media || !actions) return
    let frame = 0
    const update = () => {
      frame = 0
      const buttons = actions.getBoundingClientRect()
      setOverMedia(media.getBoundingClientRect().bottom > buttons.top + buttons.height / 2)
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [])

  return (
    <article className={styles.card}>
      <DetailToolbar
        onClose={onClose}
        onEdit={onEdit}
        onEditIntent={onEditIntent}
        editButtonRef={editButtonRef}
        actionsRef={actionsRef}
        tone={overMedia ? 'overlay' : 'surface'}
      />
      <div ref={mediaRef} className={styles.media}>
        {images.length > 0 ? (
          <Carousel
            // A different set or order of photos (after an edit) starts again from the cover.
            key={images.map((image) => image.id).join()}
            ref={carouselRef}
            images={images}
            label={carouselLabel}
            onExpand={isMobile ? openViewer : undefined}
            paused={viewerOpen}
          />
        ) : (
          <FallbackHeader category={categories[0] ?? null} />
        )}
        {categories.length > 0 && (
          <ul className={styles.pills} aria-label={t('detail.categories')}>
            {categories.map((category) => (
              <li key={category.id}>
                <CategoryPill category={category} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.content}>
        <div className={styles.meta}>
          <span className={styles.metaItem}>
            <IconCalendarEvent className={styles.metaIcon} size={18} stroke={1.9} aria-hidden="true" />
            <span className="visually-hidden">{t('detail.date')}: </span>
            <time dateTime={event.date}>{formatDate(event.date, 'long')}</time>
          </span>
          {event.location && (
            <span className={styles.metaItem}>
              <IconMapPin className={styles.metaIcon} size={18} stroke={1.9} aria-hidden="true" />
              <span className="visually-hidden">{t('detail.location')}: </span>
              <span className={styles.location}>{event.location}</span>
            </span>
          )}
          {sharedWith.length > 0 && <SharedChildren people={sharedWith} />}
        </div>
        <Heading slot="title" className={styles.title}>
          {event.title}
        </Heading>
        {notes && <p className={styles.notes}>{notes}</p>}
      </div>
      {viewerIndex !== null && (
        <PhotoViewer
          images={images}
          title={event.title}
          initialIndex={viewerIndex}
          onIndexChange={(index) => {
            lastViewed.current = index
            // The card follows underneath: it shows through while a photo is swiped down.
            carouselRef.current?.show(index)
          }}
          onClose={closeViewer}
        />
      )}
    </article>
  )
}
