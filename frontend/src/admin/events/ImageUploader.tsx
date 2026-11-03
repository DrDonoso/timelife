import {
  IconAlertTriangle,
  IconClockHour4,
  IconGripVertical,
  IconLivePhoto,
  IconLivePhotoOff,
  IconMovie,
  IconPencil,
  IconPhoto,
  IconPhotoPlus,
  IconPlayerPlayFilled,
  IconRefresh,
  IconStar,
  IconStarFilled,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  DropIndicator,
  DropZone,
  FileTrigger,
  GridList,
  GridListItem,
  Popover,
  ProgressBar,
  ToggleButton,
  TooltipTrigger,
  isFileDropItem,
  useDragAndDrop,
  type DragTypes,
  type DropItem,
  type DropOperation,
  type DropTarget,
} from 'react-aria-components'
import { Button } from '../../components/Button'
import { StaticFieldError } from '../../components/Field'
import { IconButton } from '../../components/IconButton'
import overlay from '../../components/Overlay.module.css'
import { TextField } from '../../components/TextField'
import { Tooltip } from '../../components/Tooltip'
import { cx } from '../../components/utils'
import { useI18n } from '../../i18n'
import { useCanHover } from '../../utils/useMediaQuery'
import { draftPhoto } from './draftPhoto'
import { EVENT_LIMITS, MEDIA_ACCEPT, canRetryUpload, isLiveDraft, type DraftImage } from './eventForm'
import styles from './ImageUploader.module.css'
import type { InsertTarget } from './useImageUploads'

/** Drag type of images dragged inside the grid (reordering). */
const IMAGE_DRAG_TYPE = 'application/x-timelife-event-image'

/**
 * Dragged OS files: photos, videos, `.livp` Live Photos (ZIP files), or files whose type the browser
 * doesn't know (e.g. HEIC on Windows).
 */
function hasFiles(types: DragTypes): boolean {
  return (
    types.has('image/*') ||
    types.has('video/*') ||
    types.has('application/octet-stream') ||
    types.has('application/zip') ||
    types.has('application/x-zip-compressed')
  )
}

/** `m:ss` (or `h:mm:ss`) of a duration in seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

async function filesOf(items: readonly DropItem[]): Promise<File[]> {
  return Promise.all(items.filter(isFileDropItem).map((item) => item.getFile()))
}

export interface ImageUploaderProps {
  images: readonly DraftImage[]
  /** Effective cover key. */
  coverKey: string | null
  onAddFiles: (files: File[], target?: InsertTarget | null) => void
  onRemove: (key: string) => void
  onRetry: (key: string) => void
  onRename: (key: string, name: string) => void
  onReorder: (keys: ReadonlySet<string>, target: InsertTarget) => void
  onSetCover: (key: string) => void
  /** Live Photos: show the motion or only the photo. */
  onToggleLive: (key: string, live: boolean) => void
  /** Validation error (uploads pending/failed, names…). */
  errorMessage?: string
  /** Informational message (e.g. files skipped by the limit). */
  notice?: string | null
  headingLevel?: 2 | 3
  isDisabled?: boolean
}

function Thumbnail({ image }: { image: DraftImage }) {
  const photo = draftPhoto(image.image, image.previewUrl, image.crop)
  const src = photo?.src ?? null
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) {
    const Placeholder = image.kind === 'video' ? IconMovie : isLiveDraft(image) ? IconLivePhoto : IconPhoto
    return (
      <span className={styles.placeholder} aria-hidden="true">
        <Placeholder size={30} stroke={1.5} />
      </span>
    )
  }
  return (
    <img
      className={styles.image}
      src={src}
      style={photo?.style}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(src)}
    />
  )
}

function UploadStatus({ image }: { image: DraftImage }) {
  const { t, formatNumber } = useI18n()
  const percent = Math.round(image.progress * 100)
  const processing = image.status === 'processing'
  const isIndeterminate = image.status !== 'uploading' && !processing
  const name = image.name || t('adminEvents.images.fallbackName')
  const text =
    image.status === 'queued'
      ? t('adminEvents.images.queued')
      : image.status === 'busy'
        ? t('adminEvents.images.busy')
        : processing
          ? t('adminEvents.images.processing')
          : formatNumber(image.progress, { style: 'percent' })
  return (
    <ProgressBar
      className={styles.status}
      aria-label={processing ? t('adminEvents.images.processingLabel', { name }) : t('adminEvents.images.progress', { name })}
      value={percent}
      isIndeterminate={isIndeterminate}
      data-status={image.status}
    >
      <svg className={styles.ringProgress} viewBox="0 0 36 36" aria-hidden="true">
        <circle className={styles.ringTrack} cx="18" cy="18" r="15.5" />
        <circle
          className={styles.ringValue}
          cx="18"
          cy="18"
          r="15.5"
          pathLength={100}
          style={{ '--progress': isIndeterminate ? 25 : percent } as CSSProperties}
          data-indeterminate={isIndeterminate || undefined}
        />
      </svg>
      <span className={styles.statusText}>
        {image.status === 'queued' && <IconClockHour4 size={14} aria-hidden="true" />}
        {text}
      </span>
    </ProgressBar>
  )
}

function UploadError({ image, onRetry }: { image: DraftImage; onRetry: (key: string) => void }) {
  const { t, hasMessage } = useI18n()
  const key = `errors.${image.error ?? 'unknown'}`
  const message = hasMessage(key) ? t(key) : t('errors.unknown')
  const name = image.name || t('adminEvents.images.fallbackName')
  return (
    <div className={styles.error}>
      <IconAlertTriangle size={20} aria-hidden="true" className={styles.errorIcon} />
      <p className={styles.errorText} title={message}>
        {message}
      </p>
      {canRetryUpload(image.error) && image.file && (
        <AriaButton className={styles.retry} onPress={() => onRetry(image.key)} aria-label={t('adminEvents.images.retryLabel', { name })}>
          <IconRefresh size={14} aria-hidden="true" />
          {t('adminEvents.images.retry')}
        </AriaButton>
      )}
    </div>
  )
}

function NameEditor({ image, onRename, isDisabled }: { image: DraftImage; onRename: (key: string, name: string) => void; isDisabled?: boolean }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(image.name)
  const [isOpen, setOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const name = image.name || t('adminEvents.images.fallbackName')
  const trimmed = draft.trim()
  const invalid = trimmed.length === 0 || trimmed.length > EVENT_LIMITS.imageName
  const isVideo = image.kind === 'video'
  const label = isVideo ? t('adminEvents.images.videoNameLabel') : t('adminEvents.images.nameLabel')

  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) {
          setDraft(image.name)
          setTouched(false)
        }
        setOpen(open)
      }}
    >
      <AriaButton className={styles.name} aria-label={t('adminEvents.images.rename', { name })} isDisabled={isDisabled}>
        <span className={styles.nameText} data-empty={image.name ? undefined : true}>
          {name}
        </span>
        <IconPencil size={14} aria-hidden="true" className={styles.namePencil} />
      </AriaButton>
      <Popover className={cx(overlay.popover, styles.renamePopover)} placement="bottom" offset={6}>
        <Dialog className={styles.renameDialog} aria-label={label}>
          {({ close }) => (
            <form
              className={styles.renameForm}
              onSubmit={(event) => {
                // React submit events bubble through portals: keep this one away from the event form.
                event.preventDefault()
                event.stopPropagation()
                setTouched(true)
                if (invalid) return
                onRename(image.key, trimmed)
                close()
              }}
            >
              <TextField
                label={label}
                description={isVideo ? t('adminEvents.images.videoNameDescription') : t('adminEvents.images.nameDescription')}
                value={draft}
                onChange={setDraft}
                maxLength={EVENT_LIMITS.imageName}
                errorMessage={touched && invalid ? t('adminEvents.images.nameRequired') : undefined}
                size="sm"
                autoFocus
                onFocus={(event) => event.target.select()}
              />
              <div className={styles.renameActions}>
                <Button size="sm" variant="ghost" onPress={close}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" variant="primary" type="submit">
                  {t('common.save')}
                </Button>
              </div>
            </form>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}

/** Video length on the thumbnail of a video. */
function VideoBadge({ image }: { image: DraftImage }) {
  const { t } = useI18n()
  const duration = image.image?.duration ?? null
  return (
    <span className={styles.mediaTag}>
      <IconPlayerPlayFilled size={11} aria-hidden="true" />
      {duration !== null ? (
        <>
          <span className="visually-hidden">{t('adminEvents.images.videoDuration')} </span>
          {formatDuration(duration)}
        </>
      ) : (
        t('adminEvents.images.video')
      )}
    </span>
  )
}

/** LIVE switch of a Live Photo: with the motion or only the photo. */
function LiveToggle({ image, onToggleLive, isDisabled }: { image: DraftImage; onToggleLive: (key: string, live: boolean) => void; isDisabled?: boolean }) {
  const { t } = useI18n()
  const name = image.name || t('adminEvents.images.fallbackName')
  const failed = image.image?.video_status === 'failed'
  const on = image.live && !failed
  const label = failed ? t('adminEvents.images.liveFailed', { name }) : t('adminEvents.images.live', { name })
  const help = failed ? t('adminEvents.images.liveFailedHint') : on ? t('adminEvents.images.liveOn') : t('adminEvents.images.liveOff')
  return (
    <TooltipTrigger delay={400} closeDelay={80}>
      <ToggleButton
        className={styles.liveToggle}
        isSelected={on}
        isDisabled={isDisabled || failed}
        onChange={(selected) => onToggleLive(image.key, selected)}
        aria-label={label}
      >
        {failed ? (
          <IconAlertTriangle size={14} aria-hidden="true" />
        ) : on ? (
          <IconLivePhoto size={14} aria-hidden="true" />
        ) : (
          <IconLivePhotoOff size={14} aria-hidden="true" />
        )}
        <span aria-hidden="true">{t('adminEvents.images.liveTag')}</span>
      </ToggleButton>
      <Tooltip placement="top">{help}</Tooltip>
    </TooltipTrigger>
  )
}

interface CardProps extends Pick<ImageUploaderProps, 'onRemove' | 'onRetry' | 'onRename' | 'onSetCover' | 'onToggleLive' | 'isDisabled'> {
  image: DraftImage
  isCover: boolean
}

function ImageCard({ image, isCover, onRemove, onRetry, onRename, onSetCover, onToggleLive, isDisabled }: CardProps) {
  const { t } = useI18n()
  const name = image.name || t('adminEvents.images.fallbackName')
  const busy = image.status === 'queued' || image.status === 'uploading' || image.status === 'busy' || image.status === 'processing'
  const coverLabel = isCover ? t('adminEvents.images.isCover', { name }) : t('adminEvents.images.setCover', { name })
  const live = isLiveDraft(image)

  return (
    <>
      <div className={styles.media} style={{ backgroundColor: image.image?.dominant_color }}>
        <Thumbnail image={image} />
        {busy && <UploadStatus image={image} />}
        {image.status === 'error' && <UploadError image={image} onRetry={onRetry} />}
        <AriaButton slot="drag" className={styles.handle}>
          <IconGripVertical size={18} aria-hidden="true" />
        </AriaButton>
        <div className={styles.tools}>
          <TooltipTrigger delay={600} closeDelay={80}>
            <ToggleButton
              className={styles.tool}
              isSelected={isCover}
              isDisabled={isDisabled || isCover || image.status === 'error'}
              onChange={(selected) => {
                if (selected) onSetCover(image.key)
              }}
              aria-label={coverLabel}
              data-cover={isCover || undefined}
            >
              {isCover ? <IconStarFilled size={16} aria-hidden="true" /> : <IconStar size={16} stroke={2.2} aria-hidden="true" />}
            </ToggleButton>
            <Tooltip placement="top">{coverLabel}</Tooltip>
          </TooltipTrigger>
          <IconButton
            className={styles.tool}
            variant="overlay"
            size="sm"
            icon={IconX}
            label={t('adminEvents.images.remove', { name })}
            tooltipPlacement="top"
            isDisabled={isDisabled}
            onPress={() => onRemove(image.key)}
          />
        </div>
        {isCover && (
          <span className={styles.coverTag}>
            <IconStarFilled size={12} aria-hidden="true" />
            {t('adminEvents.images.cover')}
          </span>
        )}
        {image.kind === 'video' && image.status !== 'error' && <VideoBadge image={image} />}
        {live && image.status !== 'error' && <LiveToggle image={image} onToggleLive={onToggleLive} isDisabled={isDisabled} />}
      </div>
      <NameEditor image={image} onRename={onRename} isDisabled={isDisabled} />
    </>
  )
}

/**
 * Event images: drop zone + picker (uploads start immediately), then a reorderable grid
 * (react-aria drag and drop, keyboard accessible through each card's drag handle) with cover
 * toggle, rename and remove. Files can also be dropped between existing images.
 */
export function ImageUploader({
  images,
  coverKey,
  onAddFiles,
  onRemove,
  onRetry,
  onRename,
  onReorder,
  onSetCover,
  onToggleLive,
  errorMessage,
  notice,
  headingLevel = 2,
  isDisabled = false,
}: ImageUploaderProps) {
  const { t, lang } = useI18n()
  const canHover = useCanHover()
  const headingId = useId()
  const hintId = useId()
  const Heading = `h${headingLevel}` as const
  const isFull = images.length >= EVENT_LIMITS.images

  // A file dropped next to the drop zone must not make the browser open it (leaving the editor).
  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      if (event.type === 'dragover') event.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])

  const items = useMemo(() => images.map((image) => ({ id: image.key, image, isCover: image.key === coverKey })), [images, coverKey])

  const { dragAndDropHooks } = useDragAndDrop<(typeof items)[number]>({
    isDisabled,
    getItems: (_keys, dragged) => dragged.map((item) => ({ [IMAGE_DRAG_TYPE]: item.id, 'text/plain': item.image.name })),
    getDropOperation: (target: DropTarget, types: DragTypes, allowed: DropOperation[]): DropOperation => {
      if (target.type === 'item' && target.dropPosition === 'on') return 'cancel'
      if (types.has(IMAGE_DRAG_TYPE) && !hasFiles(types)) {
        return target.type === 'item' && allowed.includes('move') ? 'move' : 'cancel'
      }
      if (isFull || !hasFiles(types)) return 'cancel'
      return allowed.includes('copy') ? 'copy' : (allowed[0] ?? 'cancel')
    },
    onReorder: (event) => {
      onReorder(new Set([...event.keys].map(String)), { key: String(event.target.key), position: event.target.dropPosition === 'after' ? 'after' : 'before' })
    },
    onInsert: async (event) => {
      const files = await filesOf(event.items)
      if (files.length > 0) {
        onAddFiles(files, { key: String(event.target.key), position: event.target.dropPosition === 'after' ? 'after' : 'before' })
      }
    },
    onRootDrop: async (event) => {
      const files = await filesOf(event.items)
      if (files.length > 0) onAddFiles(files)
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className={styles.dropIndicator} />,
  })

  const picker = (
    <FileTrigger
      acceptedFileTypes={[...MEDIA_ACCEPT]}
      allowsMultiple
      onSelect={(list) => {
        if (list && list.length > 0) onAddFiles(Array.from(list))
      }}
    >
      <Button variant={images.length > 0 ? 'secondary' : 'primary'} icon={IconUpload} isDisabled={isDisabled || isFull} size={images.length > 0 ? 'sm' : 'md'}>
        {images.length > 0 ? t('adminEvents.images.chooseMore') : t('adminEvents.images.choose')}
      </Button>
    </FileTrigger>
  )

  return (
    <section className={styles.section} aria-labelledby={headingId} data-invalid={errorMessage ? true : undefined}>
      <div className={styles.header}>
        <Heading id={headingId} className={styles.heading}>
          {t('adminEvents.images.label')}
        </Heading>
        <span className={styles.count}>{t('adminEvents.images.count', { count: images.length, max: EVENT_LIMITS.images })}</span>
      </div>

      <DropZone
        className={cx(styles.dropzone, images.length > 0 && styles.dropzoneCompact)}
        aria-label={t('adminEvents.images.dropLabel')}
        isDisabled={isDisabled || isFull}
        getDropOperation={(types, allowed) => (hasFiles(types) && !types.has(IMAGE_DRAG_TYPE) ? (allowed.includes('copy') ? 'copy' : (allowed[0] ?? 'cancel')) : 'cancel')}
        onDrop={async (event) => {
          const files = await filesOf(event.items)
          if (files.length > 0) onAddFiles(files)
        }}
      >
        {({ isDropTarget }) => (
          <>
            <span className={styles.dropIcon} aria-hidden="true">
              <IconPhotoPlus size={images.length > 0 ? 22 : 30} stroke={1.6} />
            </span>
            <div className={styles.dropText}>
              <p className={styles.dropTitle}>
                {isDropTarget
                  ? t('adminEvents.images.dropActive')
                  : canHover
                    ? t('adminEvents.images.dropTitle')
                    : t('adminEvents.images.addTitle')}
              </p>
              <p className={styles.dropHint}>{t('adminEvents.images.dropHint', { max: EVENT_LIMITS.images })}</p>
              <p className={styles.dropHint}>{t('adminEvents.images.liveHint')}</p>
            </div>
            {canHover && (
              <span className={styles.dropOr} aria-hidden="true">
                {t('adminEvents.images.dropOr')}
              </span>
            )}
            {picker}
          </>
        )}
      </DropZone>

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {images.length > 0 && (
        <>
          <p className={styles.hint} id={hintId}>
            {t('adminEvents.images.reorderHint')}
          </p>
          <GridList
            aria-label={t('adminEvents.images.gridLabel')}
            aria-describedby={hintId}
            layout="grid"
            items={items}
            dependencies={[lang, isDisabled]}
            dragAndDropHooks={dragAndDropHooks}
            className={styles.grid}
          >
            {(item) => (
              <GridListItem
                id={item.id}
                textValue={item.image.name || t('adminEvents.images.fallbackName')}
                className={styles.card}
                data-status={item.image.status}
                data-cover={item.isCover || undefined}
              >
                <ImageCard
                  image={item.image}
                  isCover={item.isCover}
                  onRemove={onRemove}
                  onRetry={onRetry}
                  onRename={onRename}
                  onSetCover={onSetCover}
                  onToggleLive={onToggleLive}
                  isDisabled={isDisabled}
                />
              </GridListItem>
            )}
          </GridList>
        </>
      )}

      <StaticFieldError>{errorMessage}</StaticFieldError>
    </section>
  )
}


