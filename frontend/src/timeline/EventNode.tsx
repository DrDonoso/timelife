import { useMemo, useState, type CSSProperties, type MouseEvent, type Ref } from 'react'
import { CategoryBadgeGroup } from '../components/CategoryBadge'
import { cx } from '../components/utils'
import { CategoryIcon } from '../icons/CategoryIcon'
import { useI18n } from '../i18n'
import { useThemeColors } from '../theme/useThemeColors'
import { categoryName, type CategoryLike } from '../utils/categories'
import { hubFill, segmentedBorder, segmentedRing } from '../utils/color'
import styles from './EventNode.module.css'
import { categoryColors, hubText } from './palette'

/** Cover of a timeline circle (`TimelineCoverOut` / `ImageOut` both fit). */
export interface EventNodeCover {
  thumb_url: string
  dominant_color: string
}

export interface EventNodeProps {
  title: string
  /** `YYYY-MM-DD` */
  date: string
  /** In event order (first = primary): ring arcs, label border and badges follow it. */
  categories: readonly CategoryLike[]
  /** Whose milestone it is ("Emma y Leo"), added to the accessible name (family timeline). */
  people?: string
  cover: EventNodeCover | null
  /** Circle diameter in px (default 104; 88 on mobile). */
  size?: number
  /** Max width of the title pill in px (default 150). */
  labelWidth?: number
  /** Turns the node into a link (the timeline opens the event detail). */
  href?: string
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void
  /** Roving tabindex (links only). */
  tabIndex?: number
  /** Hidden from assistive tech (animation copies). Non-link nodes are otherwise exposed as an image. */
  decorative?: boolean
  /** Ring "draws" in and the photo scales up after `revealDelay` seconds. */
  reveal?: boolean
  revealDelay?: number
  /** Change the value to pulse the ring twice (search jumps). */
  pulse?: number | null
  /** Identifies the node inside the timeline (`e123`). */
  nodeKey?: string
  className?: string
  ref?: Ref<HTMLAnchorElement & HTMLDivElement>
}

/**
 * Milestone circle: cover photo (dominant-colour placeholder, lazy) inside a 2 px ring split by
 * category colour, title pill above with the same colour pattern on its 1 px border, category
 * badges at the bottom-right and the short date below. Usable on its own (admin previews) — the
 * pill and the date overflow the circle's box, so leave room above and below it.
 */
export function EventNode({
  title,
  date,
  categories,
  people,
  cover,
  size = 104,
  labelWidth = 150,
  href,
  onOpen,
  tabIndex,
  decorative = false,
  reveal = false,
  revealDelay = 0,
  pulse = null,
  nodeKey,
  className,
  ref,
}: EventNodeProps) {
  const { t, lang, formatDate } = useI18n()
  const { adapt } = useThemeColors()
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const colors = useMemo(() => categoryColors(categories, adapt), [categories, adapt])
  const primary = categories[0]
  const fallbackColor = colors[0]
  const src = cover?.thumb_url || null
  const showPhoto = src !== null && failedSrc !== src

  const names = categories.map((category) => categoryName(category, lang)).join(', ')
  const longDate = formatDate(date, 'long')
  const described = names
    ? t('timeline.eventLabelWithCategories', { title, date: longDate, categories: names })
    : t('timeline.eventLabel', { title, date: longDate })
  const label = people ? t('timeline.eventLabelPeople', { label: described, people }) : described

  const style = {
    '--node-size': `${size}px`,
    '--label-width': `${labelWidth}px`,
    '--ring': segmentedRing(colors),
    '--label-border': segmentedBorder(colors),
    '--pulse-color': fallbackColor,
    '--photo-bg': showPhoto ? cover?.dominant_color : hubFill(fallbackColor),
    '--fallback-text': hubText(fallbackColor),
    '--reveal-delay': `${Math.round(revealDelay * 1000)}ms`,
  } as CSSProperties

  const content = (
    <>
      <span className={styles.label} title={title}>
        <span className={styles.labelText}>{title}</span>
      </span>
      <span className={styles.circle} data-circle="">
        <span className={styles.ring} />
        <span className={styles.photo}>
          {showPhoto ? (
            <img
              key={src}
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              data-loaded={loadedSrc === src || undefined}
              onLoad={() => setLoadedSrc(src)}
              onError={() => setFailedSrc(src)}
            />
          ) : (
            <span className={styles.fallback} data-fallback="">
              <CategoryIcon icon={primary?.icon} size={Math.round(size * 0.4)} stroke={1.6} />
            </span>
          )}
        </span>
        {pulse !== null && <span key={pulse} className={styles.pulse} />}
        {categories.length > 0 && (
          <span className={styles.badges} aria-hidden="true">
            <CategoryBadgeGroup categories={categories} max={3} size={size >= 100 ? 26 : 24} />
          </span>
        )}
      </span>
      <span className={styles.date}>{formatDate(date, 'dayMonth')}</span>
    </>
  )

  const shared = {
    className: cx(styles.node, href && styles.interactive, className),
    style,
    'data-reveal': reveal || undefined,
    'data-pulsing': pulse !== null || undefined,
    'data-node-key': nodeKey,
  }

  if (href && !decorative) {
    return (
      <a {...shared} ref={ref} href={href} aria-label={label} tabIndex={tabIndex} draggable={false} onClick={onOpen}>
        {content}
      </a>
    )
  }
  return (
    <div {...shared} ref={ref} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined}>
      {content}
    </div>
  )
}
