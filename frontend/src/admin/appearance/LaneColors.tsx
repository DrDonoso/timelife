import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconDeviceFloppy, IconInfoCircle, IconMoodKid, IconPaletteOff } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api } from '../../api/client'
import { qk, useChildren } from '../../api/queries'
import type { ChildOut } from '../../api/schema.gen'
import { Avatar } from '../../components/Avatar'
import { Button, LinkButton } from '../../components/Button'
import { ColorInput } from '../../components/ColorInput'
import { EmptyState } from '../../components/EmptyState'
import { IconButton } from '../../components/IconButton'
import { LoadingState } from '../../components/Spinner'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../../i18n'
import { THEMES } from '../../theme/themes'
import { useThemeColors } from '../../theme/useThemeColors'
import { COLOR_PRESETS, normalizeHex } from '../../utils/color'
import styles from './AppearancePage.module.css'
import { LanePreview } from './LanePreview'

interface LaneColorRowProps {
  child: ChildOut
  /** Position in the display order (picks the automatic colour). */
  index: number
  draft: string | undefined
  presets: readonly string[]
  onDraftChange: (id: number, color: string | undefined) => void
}

function LaneColorRow({ child, index, draft, presets, onDraftChange }: LaneColorRowProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const { lane } = useThemeColors()
  const rowRef = useRef<HTMLElement>(null)
  const refocus = useRef(false)
  const own = normalizeHex(child.color)
  const saved = own ?? lane(index, null)
  const color = draft ?? saved
  const isDirty = draft !== undefined && draft !== saved
  const { id, name } = child

  // A saved draft is dropped once the new colour is in the cache (never flashes the old one).
  useEffect(() => {
    if (draft !== undefined && draft === saved) onDraftChange(id, undefined)
  }, [draft, saved, id, onDraftChange])

  // Saving, undoing or removing hides the button that had focus: back to the colour field.
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    rowRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  })

  function hasFocus() {
    return rowRef.current?.contains(document.activeElement) ?? false
  }

  function applied(data: ChildOut) {
    queryClient.setQueryData<ChildOut[]>(qk.children, (current) => current?.map((item) => (item.id === data.id ? data : item)))
    void queryClient.invalidateQueries({ queryKey: qk.children })
  }

  const save = useMutation({
    mutationFn: (value: string) => api.put<ChildOut>(`/api/admin/children/${id}/color`, { color: value }),
    onSuccess: (data) => {
      refocus.current = hasFocus()
      applied(data)
      show({ tone: 'success', message: t('adminAppearance.lanes.saved', { name: data.name }) })
    },
    onError: (error) => show({ tone: 'error', message: errorMessage(error) }),
  })

  const remove = useMutation({
    mutationFn: () => api.del<ChildOut>(`/api/admin/children/${id}/color`),
    onSuccess: (data) => {
      refocus.current = hasFocus()
      onDraftChange(id, undefined)
      applied(data)
      show({ tone: 'success', message: t('adminAppearance.lanes.removed', { name: data.name }) })
    },
    onError: (error) => show({ tone: 'error', message: errorMessage(error) }),
  })

  const busy = save.isPending || remove.isPending

  return (
    <article ref={rowRef} className={styles.laneRow} data-lane-row={id} aria-labelledby={`lane-${id}-name`}>
      <span className={styles.laneAvatar} style={{ '--lane-color': lane(index, draft ?? own) } as CSSProperties}>
        <Avatar name={name} image={child.avatar} size={44} decorative />
      </span>
      <div className={styles.laneHeading}>
        <h3 id={`lane-${id}-name`} className={styles.laneName}>
          {name}
        </h3>
        <span className={styles.tag} data-tone={own ? 'custom' : 'auto'}>
          {t(own ? 'adminAppearance.lanes.custom' : 'adminAppearance.lanes.automatic')}
        </span>
        {isDirty && (
          <span className={styles.tag} data-tone="unsaved">
            {t('adminAppearance.lanes.unsaved')}
          </span>
        )}
        {own && (
          <IconButton
            size="sm"
            icon={IconPaletteOff}
            label={t('adminAppearance.lanes.removeColor', { name })}
            isLoading={remove.isPending}
            isDisabled={save.isPending}
            onPress={() => remove.mutate()}
          />
        )}
      </div>
      <ColorInput
        label={t('adminAppearance.lanes.color', { name })}
        value={color}
        onChange={(hex) => onDraftChange(id, hex === saved ? undefined : hex)}
        presets={presets}
        isDisabled={busy}
        className={styles.laneColor}
      />
      <div className={styles.laneActions}>
        {isDirty && (
          <>
            <Button
              size="sm"
              variant="primary"
              icon={IconDeviceFloppy}
              isLoading={save.isPending}
              isDisabled={remove.isPending}
              onPress={() => save.mutate(normalizeHex(color) ?? color)}
              aria-label={t('adminAppearance.lanes.saveLabel', { name })}
            >
              {t('adminAppearance.lanes.save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={busy}
              onPress={() => {
                refocus.current = true
                onDraftChange(id, undefined)
              }}
            >
              {t('adminAppearance.lanes.undo')}
            </Button>
          </>
        )}
      </div>
    </article>
  )
}

/** «Todos juntos»: the colour of each child's line on the family timeline (own or automatic). */
export function LaneColorsSection() {
  const { t } = useI18n()
  const errorMessage = useErrorMessage()
  const { palette, lane } = useThemeColors()
  const children = useChildren()
  const [drafts, setDrafts] = useState<Readonly<Record<number, string>>>({})
  /** The theme's lane palette first (its automatic colours), then the category colours. */
  const presets = useMemo(() => [...new Set([...THEMES[palette].lanes, ...COLOR_PRESETS])], [palette])

  const setDraft = useCallback((id: number, color: string | undefined) => {
    setDrafts((current) => {
      if (color === undefined) {
        if (!(id in current)) return current
        const next = { ...current }
        delete next[id]
        return next
      }
      return { ...current, [id]: color }
    })
  }, [])

  let content
  if (children.isPending) {
    content = <LoadingState message={t('common.loading')} />
  } else if (children.isError) {
    content = (
      <EmptyState
        size="sm"
        headingLevel={3}
        tone="error"
        icon={IconAlertTriangle}
        title={t('adminAppearance.lanes.loadError')}
        description={errorMessage(children.error)}
        actions={<Button onPress={() => void children.refetch()}>{t('common.retry')}</Button>}
      />
    )
  } else if (children.data.length === 0) {
    content = (
      <div className={styles.empty}>
        <p>{t('adminAppearance.lanes.empty')}</p>
        <LinkButton href="/admin/children" size="sm" icon={IconMoodKid} className={styles.emptyAction}>
          {t('adminAppearance.lanes.goToChildren')}
        </LinkButton>
      </div>
    )
  } else {
    const list = children.data
    content = (
      <>
        {list.length > 1 ? (
          <LanePreview
            lanes={list.map((child, index) => ({
              id: child.id,
              name: child.name,
              avatar: child.avatar,
              color: lane(index, drafts[child.id] ?? child.color),
            }))}
          />
        ) : (
          <p className={styles.laneNote}>
            <IconInfoCircle size={18} stroke={1.9} aria-hidden="true" />
            <span>{t('adminAppearance.lanes.single')}</span>
          </p>
        )}
        <div className={styles.laneList}>
          {list.map((child, index) => (
            <LaneColorRow
              key={child.id}
              child={child}
              index={index}
              draft={drafts[child.id]}
              presets={presets}
              onDraftChange={setDraft}
            />
          ))}
        </div>
      </>
    )
  }

  return (
    <section className={styles.card} aria-labelledby="lane-colors-heading">
      <header className={styles.cardHeader}>
        <div>
          <h2 id="lane-colors-heading" className={styles.cardTitle}>
            {t('adminAppearance.lanes.title')}
          </h2>
          <p className={styles.cardDescription}>{t('adminAppearance.lanes.description')}</p>
        </div>
      </header>
      {content}
    </section>
  )
}
