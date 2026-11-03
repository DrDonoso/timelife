import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconCalendarEvent,
  IconCalendarMonth,
  IconDeviceDesktop,
  IconDeviceMobile,
  IconPhotoOff,
  IconTimeline,
  IconUpload,
  type TablerIcon,
} from '@tabler/icons-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { FileTrigger } from 'react-aria-components'
import { api } from '../../api/client'
import { qk } from '../../api/queries'
import type { AppearanceOut, ImageOut, SettingsIn } from '../../api/schema.gen'
import { Button } from '../../components/Button'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Slider } from '../../components/Switch'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../../i18n'
import { useThemeColors } from '../../theme/useThemeColors'
import { ensureContrast, hubFill, readableText, segmentedRing } from '../../utils/color'
import { UploadStatus } from '../children/UploadStatus'
import { IMAGE_ACCEPT, useImageUpload } from '../children/useImageUpload'
import styles from './AppearancePage.module.css'

type Zoom = AppearanceOut['default_zoom']
type Direction = AppearanceOut['direction_desktop']
type Device = 'desktop' | 'mobile'

interface SettingsDraft {
  background?: ImageOut | null
  opacity?: number
  zoom?: Zoom
  desktop?: Direction
  mobile?: Direction
}

const SAMPLE_RINGS = [['#f59e0b'], ['#8b5cf6', '#22c55e'], ['#ec4899']]
const DIRECTION_ICONS = {
  left_to_right: IconArrowRight,
  right_to_left: IconArrowLeft,
  top_to_bottom: IconArrowDown,
  bottom_to_top: IconArrowUp,
} as const satisfies Record<Direction, unknown>
const DIRECTIONS = Object.keys(DIRECTION_ICONS) as Direction[]
const DEVICES: ReadonlyArray<{ device: Device; icon: TablerIcon }> = [
  { device: 'desktop', icon: IconDeviceDesktop },
  { device: 'mobile', icon: IconDeviceMobile },
]

function roundOpacity(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

/** Mini line of four milestones from the oldest (small, faint) to the newest (large, brand colour). */
function DirectionPreview({ direction }: { direction: Direction }) {
  return (
    <span className={styles.directionPreview} data-direction={direction} aria-hidden="true">
      <span className={styles.directionLine} />
      {[0, 1, 2, 3].map((step) => (
        <span key={step} className={styles.directionDot} data-step={step} />
      ))}
    </span>
  )
}

/** Direction of the timeline on one kind of device: four arrows, a preview and what it means. */
function DirectionSetting({
  device,
  icon: Icon,
  value,
  onChange,
  isDisabled,
}: {
  device: Device
  icon: TablerIcon
  value: Direction
  onChange: (value: Direction) => void
  isDisabled: boolean
}) {
  const { t } = useI18n()
  const options = DIRECTIONS.map((direction) => ({
    value: direction,
    label: null,
    icon: DIRECTION_ICONS[direction],
    'aria-label': t(`adminAppearance.direction.options.${direction}`),
  }))
  return (
    <div className={styles.directionSetting}>
      <span className={styles.directionDevice}>
        <Icon size={18} stroke={2} aria-hidden="true" />
        {t(`adminAppearance.direction.${device}`)}
      </span>
      <div className={styles.directionControl}>
        <SegmentedControl
          aria-label={t(`adminAppearance.direction.${device}Label`)}
          options={options}
          value={value}
          onChange={onChange}
          isDisabled={isDisabled}
          fullWidth
        />
        <DirectionPreview direction={value} />
      </div>
      <p className={styles.zoomHint}>{t(`adminAppearance.direction.hint.${value}`)}</p>
    </div>
  )
}

/** The timeline background as the timeline draws it, with a few sample nodes on top (in the palette's colours). */
function BackgroundPreview({
  imageUrl,
  opacity,
  hubColor,
  year,
}: {
  imageUrl: string | null
  opacity: number
  /** Already painted for the palette (`useThemeColors().year`). */
  hubColor: string
  year: number
}) {
  const { t } = useI18n()
  const { adapt } = useThemeColors()
  const hubStyle = useMemo(
    () => ({ '--hub-fill': hubFill(hubColor), '--hub-text': readableText(hubColor, true) }) as CSSProperties,
    [hubColor],
  )
  const samples = useMemo(
    () =>
      SAMPLE_RINGS.map((ring) => {
        const colors = ring.map((color) => adapt(color))
        return {
          '--sample-ring': segmentedRing(colors),
          '--sample-fill': `linear-gradient(145deg, ${ensureContrast(colors[0], '#ffffff', 2)}, ${ensureContrast(colors[0])})`,
        } as CSSProperties
      }),
    [adapt],
  )
  return (
    <div
      className={styles.bgPreview}
      role="img"
      aria-label={imageUrl ? t('adminAppearance.background.previewImage', { opacity: Math.round(opacity * 100) }) : t('adminAppearance.background.previewDefault')}
    >
      {imageUrl ? (
        <div className={styles.bgImage} style={{ backgroundImage: `url("${imageUrl}")`, opacity }} />
      ) : (
        <div className={styles.bgPattern} />
      )}
      <div className={styles.bgSample} aria-hidden="true">
        <span className={styles.sampleLine} />
        <span className={styles.sampleHub} style={hubStyle}>
          {year}
        </span>
        {samples.map((style, index) => (
          <span key={index} className={styles.sampleNode} style={style} />
        ))}
      </div>
      {!imageUrl && <span className={styles.bgBadge}>{t('adminAppearance.background.default')}</span>}
    </div>
  )
}

/** Background image + opacity, the default zoom and the directions, saved together with `PUT /api/admin/settings`. */
export function TimelineSettingsSection({ appearance }: { appearance: AppearanceOut }) {
  const { t } = useI18n()
  const themeColors = useThemeColors()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const [draft, setDraft] = useState<SettingsDraft>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [currentYear] = useState(() => new Date().getFullYear())
  const uploader = useImageUpload('background', (image) => {
    setFormError(null)
    setDraft((current) => ({ ...current, background: image }))
  })
  const uploading = uploader.state.status === 'uploading'

  const background = draft.background !== undefined ? draft.background : appearance.background
  const opacity = draft.opacity ?? appearance.background_opacity
  const zoom = draft.zoom ?? appearance.default_zoom
  const directions: Record<Device, Direction> = {
    desktop: draft.desktop ?? appearance.direction_desktop,
    mobile: draft.mobile ?? appearance.direction_mobile,
  }
  const isDirty =
    (background?.id ?? null) !== (appearance.background?.id ?? null) ||
    Math.abs(opacity - appearance.background_opacity) > 0.001 ||
    zoom !== appearance.default_zoom ||
    directions.desktop !== appearance.direction_desktop ||
    directions.mobile !== appearance.direction_mobile

  const newestYear = appearance.event_years[0] ?? currentYear
  const hubColor = appearance.event_years.length > 0 ? themeColors.year(newestYear, appearance.year_colors) : themeColors.autoYear(newestYear)
  const imageUrl = (uploading ? uploader.state.previewUrl : null) ?? background?.display_url ?? null

  const save = useMutation({
    mutationFn: (body: SettingsIn) => api.put<AppearanceOut>('/api/admin/settings', body),
    onSuccess: (data) => {
      setDraft({})
      setFormError(null)
      queryClient.setQueryData(qk.appearance, data)
      void queryClient.invalidateQueries({ queryKey: qk.appearance })
      show({ tone: 'success', message: t('adminAppearance.settings.saved') })
    },
    onError: (error) => setFormError(errorMessage(error)),
  })

  function submit() {
    if (!isDirty || uploading || save.isPending) return
    save.mutate({
      background_image_id: background?.id ?? null,
      background_opacity: roundOpacity(opacity),
      default_zoom: zoom,
      direction_desktop: directions.desktop,
      direction_mobile: directions.mobile,
    })
  }

  function discard() {
    uploader.cancel()
    setDraft({})
    setFormError(null)
  }

  const zoomOptions = [
    { value: 'years' as const, label: t('adminAppearance.zoom.years'), icon: IconTimeline },
    { value: 'months' as const, label: t('adminAppearance.zoom.months'), icon: IconCalendarMonth },
    { value: 'events' as const, label: t('adminAppearance.zoom.events'), icon: IconCalendarEvent },
  ]

  return (
    <section className={styles.card} aria-labelledby="timeline-settings-heading">
      <header className={styles.cardHeader}>
        <div>
          <h2 id="timeline-settings-heading" className={styles.cardTitle}>
            {t('adminAppearance.settings.title')}
          </h2>
          <p className={styles.cardDescription}>{t('adminAppearance.settings.description')}</p>
        </div>
      </header>

      <div className={styles.settingsGrid}>
        <div className={styles.settingsBlock}>
          <h3 className={styles.blockTitle}>{t('adminAppearance.background.title')}</h3>
          <p className={styles.blockDescription}>{t('adminAppearance.background.description')}</p>
          <BackgroundPreview imageUrl={imageUrl} opacity={opacity} hubColor={hubColor} year={newestYear} />
          <div className={styles.bgActions}>
            <FileTrigger
              acceptedFileTypes={IMAGE_ACCEPT}
              onSelect={(files) => {
                const file = files?.[0]
                if (file) void uploader.upload(file)
              }}
            >
              <Button size="sm" icon={IconUpload} isDisabled={uploading || save.isPending}>
                {t(background ? 'adminAppearance.background.change' : 'adminAppearance.background.upload')}
              </Button>
            </FileTrigger>
            {background && !uploading && (
              <Button
                size="sm"
                variant="ghost"
                icon={IconPhotoOff}
                isDisabled={save.isPending}
                onPress={() => setDraft((current) => ({ ...current, background: null }))}
              >
                {t('adminAppearance.background.remove')}
              </Button>
            )}
            <span className={styles.bgHint}>{t('adminAppearance.background.hint')}</span>
          </div>
          <UploadStatus state={uploader.state} onCancel={uploader.cancel} onRetry={uploader.retry} />
          <Slider
            label={t('adminAppearance.background.opacity')}
            value={opacity}
            onChange={(value) => setDraft((current) => ({ ...current, opacity: roundOpacity(value) }))}
            minValue={0}
            maxValue={1}
            step={0.01}
            formatOptions={{ style: 'percent', maximumFractionDigits: 0 }}
            isDisabled={!background || save.isPending}
            className={styles.opacity}
          />
          <p className={styles.blockDescription}>
            {background ? t('adminAppearance.background.opacityHelp') : t('adminAppearance.background.opacityDisabled')}
          </p>
        </div>

        <div className={styles.settingsColumn}>
          <div className={styles.settingsBlock}>
            <h3 className={styles.blockTitle} id="default-zoom-heading">
              {t('adminAppearance.zoom.title')}
            </h3>
            <p className={styles.blockDescription}>{t('adminAppearance.zoom.description')}</p>
            <SegmentedControl
              aria-label={t('adminAppearance.zoom.label')}
              options={zoomOptions}
              value={zoom}
              onChange={(value) => setDraft((current) => ({ ...current, zoom: value }))}
              isDisabled={save.isPending}
              fullWidth
            />
            <p className={styles.zoomHint}>{t(`adminAppearance.zoom.hint.${zoom}`)}</p>
          </div>

          <div className={styles.settingsBlock}>
            <h3 className={styles.blockTitle}>{t('adminAppearance.direction.title')}</h3>
            <p className={styles.blockDescription}>{t('adminAppearance.direction.description')}</p>
            {DEVICES.map(({ device, icon }) => (
              <DirectionSetting
                key={device}
                device={device}
                icon={icon}
                value={directions[device]}
                onChange={(value) =>
                  setDraft((current) => (device === 'desktop' ? { ...current, desktop: value } : { ...current, mobile: value }))
                }
                isDisabled={save.isPending}
              />
            ))}
          </div>
        </div>
      </div>

      {formError && (
        <p className={styles.formError} role="alert">
          <IconAlertTriangle size={18} aria-hidden="true" />
          {formError}
        </p>
      )}
      <footer className={styles.cardFooter} data-dirty={isDirty || undefined}>
        <span className={styles.footerStatus} role="status">
          {isDirty ? t('adminAppearance.settings.unsaved') : ''}
        </span>
        <Button variant="ghost" isDisabled={!isDirty || save.isPending} onPress={discard}>
          {t('adminAppearance.settings.discard')}
        </Button>
        <Button variant="primary" isDisabled={!isDirty || uploading} isLoading={save.isPending} onPress={submit}>
          {t('adminAppearance.settings.save')}
        </Button>
      </footer>
    </section>
  )
}
