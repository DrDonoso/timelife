import { useMemo, useState, type CSSProperties } from 'react'
import type { ImageOut } from '../api/schema.gen'
import { useI18n } from '../i18n'
import { ensureContrast, shiftLightness } from '../utils/color'
import styles from './Avatar.module.css'
import { cx } from './utils'

const SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80 } as const
export type AvatarSize = keyof typeof SIZES

/** Warm palette for initials (deterministic per name). */
const AVATAR_COLORS = ['#e9963a', '#e3734f', '#d45f88', '#a66dd4', '#5b8def', '#2f9e8f', '#c9784a', '#7f9c3a']

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1) ?? ''] : words
  return letters
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase()
}

function colorFor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export interface AvatarProps {
  name: string
  /** Photo (uses `thumb_url`); falls back to initials if missing or broken. */
  image?: ImageOut | null
  size?: AvatarSize | number
  /** Hide from assistive tech when the name is already visible next to it. */
  decorative?: boolean
  /** Ring in the page background colour (for overlapping stacks). */
  ring?: boolean
  className?: string
}

/** Round avatar: photo thumbnail or coloured initials. */
export function Avatar({ name, image, size = 'md', decorative = false, ring = false, className }: AvatarProps) {
  const pixels = typeof size === 'number' ? size : SIZES[size]
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = Boolean(image) && image?.thumb_url !== failedUrl
  const base = colorFor(name)
  // Deepened until white initials reach 4.5:1, with a lighter top-left for a soft, rounded look.
  const palette = useMemo(() => {
    const deep = ensureContrast(base)
    return { from: shiftLightness(deep, 0.07), to: deep, text: '#ffffff' }
  }, [base])
  const style = {
    '--avatar-size': `${pixels}px`,
    '--avatar-from': palette.from,
    '--avatar-to': palette.to,
    '--avatar-text': palette.text,
    backgroundColor: showImage ? image?.dominant_color : undefined,
  } as CSSProperties

  return (
    <span
      className={cx(styles.avatar, ring && styles.ring, !showImage && styles.initials, className)}
      style={style}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : name}
    >
      {showImage && image ? (
        <img
          className={styles.image}
          src={image.thumb_url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(image.thumb_url)}
        />
      ) : (
        <span className={styles.letters} aria-hidden="true">
          {initialsOf(name)}
        </span>
      )}
    </span>
  )
}

export interface AvatarGroupPerson {
  id?: number | string
  name: string
  image?: ImageOut | null
}

export interface AvatarGroupProps {
  people: readonly AvatarGroupPerson[]
  /** Visible avatars before the "+N" chip (default 3). */
  max?: number
  size?: AvatarSize | number
  /** Accessible group name; defaults to the comma-separated names. */
  label?: string
  className?: string
}

/** Overlapping avatars with a "+N" overflow chip. */
export function AvatarGroup({ people, max = 3, size = 'sm', label, className }: AvatarGroupProps) {
  const { t } = useI18n()
  const visible = people.slice(0, max)
  const hidden = people.length - visible.length
  const pixels = typeof size === 'number' ? size : SIZES[size]
  return (
    <span
      className={cx(styles.group, className)}
      role="img"
      aria-label={label ?? people.map((person) => person.name).join(', ')}
      style={{ '--avatar-size': `${pixels}px` } as CSSProperties}
    >
      {visible.map((person, index) => (
        <Avatar key={person.id ?? `${person.name}-${index}`} name={person.name} image={person.image} size={pixels} decorative ring />
      ))}
      {hidden > 0 && (
        <span className={styles.more} aria-hidden="true" title={t('components.avatarGroup.more', { count: hidden })}>
          +{hidden}
        </span>
      )}
    </span>
  )
}
