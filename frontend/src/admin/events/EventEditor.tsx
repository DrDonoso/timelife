import {
  IconAlertTriangle,
  IconCalendarOff,
  IconDeviceFloppy,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router'
import { isApiError } from '../../api/client'
import { useCategories, useChildren } from '../../api/queries'
import type { CategoryOut, ChildOut, EventOut, LocationOut } from '../../api/schema.gen'
import { Button, LinkButton } from '../../components/Button'
import { ChipMultiSelect } from '../../components/ChipMultiSelect'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DateField } from '../../components/DateField'
import { EmptyState } from '../../components/EmptyState'
import { StaticFieldError } from '../../components/Field'
import { LoadingState } from '../../components/Spinner'
import { TextAreaField } from '../../components/TextAreaField'
import { TextField } from '../../components/TextField'
import { cx } from '../../components/utils'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useFieldErrors, useI18n } from '../../i18n'
import { categoriesById, categoryName, pickCategories } from '../../utils/categories'
import { useAdminEvent, useLocations, useSaveEvent } from './adminEventsApi'
import { CoverCropDialog } from './CoverCropDialog'
import { draftPhoto } from './draftPhoto'
import styles from './EventEditor.module.css'
import {
  EVENT_LIMITS,
  buildEventIn,
  buildEventUpdateIn,
  draftFromImage,
  fieldOfErrorCode,
  formSnapshot,
  initialFormValues,
  serverFieldOf,
  validateEventForm,
  type EventField,
  type EventFormErrors,
  type EventFormValues,
} from './eventForm'
import { EventPreview } from './EventPreview'
import { ImageUploader } from './ImageUploader'
import { LocationField } from './LocationField'
import { useImageUploads, type InsertTarget } from './useImageUploads'

export interface EventEditorProps {
  /** Existing event to edit; omit to create a new one. */
  eventId?: number
  /** Pre-selected children for a new event (e.g. the current child). */
  defaultChildIds?: number[]
  onSaved: (event: EventOut) => void
  onCancel: () => void
  /** `page` (admin route: cards, sticky actions, leave guard) or `modal` (inside the detail modal). */
  variant?: 'page' | 'modal'
  /**
   * Called whenever the form starts or stops having unsaved changes (also with `false` when the
   * form goes away), e.g. so the detail modal only guards the browser Back button when needed.
   */
  onDirtyChange?: (dirty: boolean) => void
}

const FIELD_ORDER: readonly EventField[] = ['title', 'date', 'children', 'categories', 'location', 'notes', 'images']
const NO_PLACES: readonly LocationOut[] = []

/** Asks before leaving the page with unsaved changes (router navigations; reloads use beforeunload). */
function UnsavedChangesGuard({ when, allowLeave }: { when: boolean; allowLeave: RefObject<boolean> }) {
  const { t } = useI18n()
  const proceeding = useRef(false)
  const shouldBlock = useMemo<BlockerFunction>(
    () =>
      ({ currentLocation, nextLocation }) =>
        when && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname,
    [when, allowLeave],
  )
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    if (blocker.state === 'unblocked') proceeding.current = false
  }, [blocker.state])

  return (
    <ConfirmDialog
      isOpen={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && !proceeding.current) blocker.reset?.()
      }}
      title={t('adminEvents.editor.unsaved.title')}
      confirmLabel={t('adminEvents.editor.unsaved.confirm')}
      cancelLabel={t('adminEvents.editor.unsaved.stay')}
      onConfirm={() => {
        proceeding.current = true
        blocker.proceed?.()
      }}
    >
      {t('adminEvents.editor.unsaved.message')}
    </ConfirmDialog>
  )
}

function useBeforeUnloadWarning(when: boolean) {
  useEffect(() => {
    if (!when) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [when])
}

interface EventFormProps {
  event: EventOut | null
  initialChildIds: number[]
  childList: ChildOut[]
  categoryList: CategoryOut[]
  variant: 'page' | 'modal'
  onSaved: (event: EventOut) => void
  onCancel: () => void
  onReload: () => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}

/** Reports `dirty` to `onDirtyChange` when it changes, and `false` on unmount. */
function useReportDirty(dirty: boolean, onDirtyChange: ((dirty: boolean) => void) | undefined) {
  const report = useRef(onDirtyChange)
  useEffect(() => {
    report.current = onDirtyChange
  }, [onDirtyChange])
  useEffect(() => {
    report.current?.(dirty)
  }, [dirty])
  useEffect(() => () => report.current?.(false), [])
}

function EventForm({ event, initialChildIds, childList, categoryList, variant, onSaved, onCancel, onReload, onDirtyChange }: EventFormProps) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const fieldErrorsOf = useFieldErrors()
  const save = useSaveEvent(event?.id)
  const uploads = useImageUploads(event?.images ?? [], event?.cover_image_id ?? null)
  const locations = useLocations()
  const [values, setValues] = useState<EventFormValues>(() => initialFormValues(event, initialChildIds))
  const [initialSnapshot] = useState(() =>
    formSnapshot(initialFormValues(event, initialChildIds), (event?.images ?? []).map(draftFromImage), event?.cover_image_id ?? null),
  )
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<EventFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isStale, setStale] = useState(false)
  const [isReloading, setReloading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const allowLeave = useRef(false)
  const fieldRefs = useRef<Partial<Record<EventField, HTMLElement | null>>>({})
  const detailsId = useId()
  const titleId = useId()

  const isEdit = event !== null
  const isModal = variant === 'modal'
  const SectionHeading = isModal ? 'h3' : 'h2'
  const isDirty = formSnapshot(values, uploads.images, uploads.chosenCoverKey) !== initialSnapshot
  const uploading = uploads.images.filter((image) => image.status === 'queued' || image.status === 'uploading' || image.status === 'busy').length
  const processing = uploads.images.filter((image) => image.status === 'processing').length
  const clientErrors = validateEventForm(values, uploads.images, t)
  const errors: EventFormErrors = { ...serverErrors, ...(submitted ? clientErrors : {}) }

  useBeforeUnloadWarning(isDirty && !save.isSuccess)
  useReportDirty(isDirty && !save.isSuccess, onDirtyChange)

  const byId = useMemo(() => categoriesById(categoryList), [categoryList])
  const selectedCategories = useMemo(() => pickCategories(values.categoryIds, byId), [values.categoryIds, byId])
  const childOptions = useMemo(() => childList.map((child) => ({ id: child.id, label: child.name, image: child.avatar })), [childList])
  const categoryOptions = useMemo(
    () => categoryList.map((category) => ({ id: category.id, label: categoryName(category, lang), color: category.color, icon: category.icon })),
    [categoryList, lang],
  )
  const cover = uploads.images.find((image) => image.key === uploads.coverKey) ?? null
  const coverPhoto = cover ? draftPhoto(cover.image, cover.previewUrl, cover.crop) : null
  const [cropOpen, setCropOpen] = useState(false)

  function clearServerError(field: EventField) {
    if (!serverErrors[field]) return
    setServerErrors((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function change<K extends keyof EventFormValues>(key: K, field: EventField, value: EventFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
    clearServerError(field)
  }

  function focusField(field: EventField) {
    const container = fieldRefs.current[field]
    if (!container) return
    container.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // The images panel itself takes focus (its error is inside); fields focus their first control.
    const target =
      field === 'images'
        ? container
        : container.querySelector<HTMLElement>(
            'input:not([type="hidden"]):not([type="file"]), textarea, [role="spinbutton"], button:not([disabled])',
          )
    target?.focus({ preventScroll: true })
  }

  function addFiles(files: File[], target?: InsertTarget | null) {
    const skipped = uploads.addFiles(files, target)
    setNotice(skipped > 0 ? t('adminEvents.images.limit', { count: skipped, max: EVENT_LIMITS.images }) : null)
    clearServerError('images')
  }

  async function submit() {
    setSubmitted(true)
    setFormError(null)
    setStale(false)
    const invalid = FIELD_ORDER.find((field) => clientErrors[field])
    if (invalid) {
      setFormError(t('adminEvents.editor.validation.summary'))
      focusField(invalid)
      return
    }
    const payload = event
      ? buildEventUpdateIn(values, uploads.images, uploads.chosenCoverKey, event.version)
      : buildEventIn(values, uploads.images, uploads.chosenCoverKey)
    try {
      const saved = await save.mutateAsync(payload)
      allowLeave.current = true
      const child = childList.find((item) => saved.child_ids.includes(item.id))
      toast.show({
        tone: 'success',
        message: isEdit ? t('adminEvents.editor.saved') : t('adminEvents.editor.created', { title: saved.title }),
        action: !isModal && child ? { label: t('adminEvents.editor.viewOnTimeline'), to: `/c/${child.slug}/e/${saved.id}` } : undefined,
      })
      onSaved(saved)
    } catch (error) {
      if (isApiError(error, 'event_stale')) {
        setStale(true)
        return
      }
      const mapped: EventFormErrors = {}
      for (const [name, message] of Object.entries(fieldErrorsOf(error))) {
        const field = serverFieldOf(name)
        if (field) mapped[field] = message
      }
      const codeField = isApiError(error) ? fieldOfErrorCode(error.code) : null
      if (codeField) mapped[codeField] = errorMessage(error)
      setServerErrors(mapped)
      const first = FIELD_ORDER.find((field) => mapped[field])
      setFormError(first ? t('adminEvents.editor.validation.summary') : errorMessage(error))
      if (first) focusField(first)
    }
  }

  async function reload() {
    setReloading(true)
    try {
      await onReload()
    } finally {
      setReloading(false)
    }
  }

  function cancel() {
    if (isModal && isDirty) setConfirmCancel(true)
    else onCancel()
  }

  const setRef = (field: EventField) => (element: HTMLElement | null) => {
    fieldRefs.current[field] = element
  }

  const status = uploading > 0
    ? t('adminEvents.editor.status.uploading', { count: uploading })
    : isDirty
      ? t('adminEvents.editor.status.unsaved')
      : processing > 0
        ? t('adminEvents.editor.status.processing', { count: processing })
        : isEdit
          ? t('adminEvents.editor.status.saved')
          : ''

  return (
    <form
      className={cx(styles.editor, isModal ? styles.modal : styles.page)}
      noValidate
      aria-labelledby={isModal ? titleId : undefined}
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault()
        // A created event is done: submitting again (e.g. while a modal closes) would duplicate it.
        if (!save.isPending && !(save.isSuccess && !isEdit)) void submit()
      }}
    >
      {isModal && (
        <header className={styles.modalHeader}>
          <h2 id={titleId} className={styles.modalTitle}>
            {isEdit ? t('adminEvents.editor.editTitle') : t('adminEvents.editor.newTitle')}
          </h2>
          <p className={styles.requiredHint}>{t('adminEvents.editor.requiredHint')}</p>
        </header>
      )}

      {isStale && (
        <div className={styles.stale} role="alert">
          <IconAlertTriangle size={22} aria-hidden="true" className={styles.staleIcon} />
          <div className={styles.staleText}>
            <p className={styles.staleTitle}>{t('adminEvents.editor.stale.title')}</p>
            <p>{t('adminEvents.editor.stale.message')}</p>
          </div>
          <Button variant="primary" size="sm" icon={IconRefresh} isLoading={isReloading} onPress={() => void reload()}>
            {t('adminEvents.editor.stale.reload')}
          </Button>
        </div>
      )}

      <div className={styles.layout}>
        <section className={cx(styles.panel, styles.details)} aria-labelledby={detailsId}>
          <div className={styles.panelHeader}>
            <SectionHeading id={detailsId} className={styles.panelTitle}>
              {t('adminEvents.editor.details')}
            </SectionHeading>
            {!isModal && <p className={styles.requiredHint}>{t('adminEvents.editor.requiredHint')}</p>}
          </div>

          <div ref={setRef('title')}>
            <TextField
              label={t('adminEvents.editor.fields.title')}
              placeholder={t('adminEvents.editor.fields.titlePlaceholder')}
              value={values.title}
              onChange={(value) => change('title', 'title', value)}
              maxLength={EVENT_LIMITS.title}
              isRequired
              errorMessage={errors.title}
              autoFocus={!isEdit && !isModal}
            />
          </div>

          <div className={styles.row}>
            <div ref={setRef('date')}>
              <DateField
                label={t('adminEvents.editor.fields.date')}
                value={values.date}
                onChange={(value) => change('date', 'date', value)}
                isRequired
                errorMessage={errors.date}
              />
            </div>
            <div ref={setRef('location')}>
              <LocationField
                label={t('adminEvents.editor.fields.location')}
                placeholder={t('adminEvents.editor.fields.locationPlaceholder')}
                value={values.location}
                onChange={(value) => change('location', 'location', value)}
                places={locations.data ?? NO_PLACES}
                maxLength={EVENT_LIMITS.location}
                errorMessage={errors.location}
              />
            </div>
          </div>

          <div ref={setRef('children')}>
            {childList.length > 0 ? (
              <ChipMultiSelect
                label={t('adminEvents.editor.fields.children')}
                description={childList.length > 1 ? t('adminEvents.editor.fields.childrenDescription') : undefined}
                options={childOptions}
                value={values.childIds}
                onChange={(value) => change('childIds', 'children', value)}
                isRequired
                errorMessage={errors.children}
              />
            ) : (
              <MissingOptions
                label={t('adminEvents.editor.fields.children')}
                message={t('adminEvents.editor.noChildren')}
                action={t('adminEvents.editor.addChildren')}
                href="/admin/children"
                errorMessage={errors.children}
              />
            )}
          </div>

          <div ref={setRef('categories')}>
            {categoryList.length > 0 ? (
              <ChipMultiSelect
                ordered
                label={t('adminEvents.editor.fields.categories')}
                description={t('adminEvents.editor.fields.categoriesDescription')}
                options={categoryOptions}
                value={values.categoryIds}
                onChange={(value) => change('categoryIds', 'categories', value)}
                isRequired
                errorMessage={errors.categories}
              />
            ) : (
              <MissingOptions
                label={t('adminEvents.editor.fields.categories')}
                message={t('adminEvents.editor.noCategories')}
                action={t('adminEvents.editor.addCategories')}
                href="/admin/categories"
                errorMessage={errors.categories}
              />
            )}
          </div>

          <div ref={setRef('notes')}>
            <TextAreaField
              label={t('adminEvents.editor.fields.notes')}
              placeholder={t('adminEvents.editor.fields.notesPlaceholder')}
              value={values.notes}
              onChange={(value) => change('notes', 'notes', value)}
              rows={5}
              maxLength={EVENT_LIMITS.notes}
              showCount
              errorMessage={errors.notes}
            />
          </div>
        </section>

        <aside className={cx(styles.panel, styles.aside)}>
          <EventPreview
            title={values.title}
            date={values.date}
            categories={selectedCategories}
            coverSrc={coverPhoto?.src ?? null}
            coverStyle={coverPhoto?.style}
            coverPlaceholder={cover?.image?.dominant_color}
            onAdjustCover={() => setCropOpen(true)}
            canAdjustCover={Boolean(cover?.image)}
          />
          {cover?.image && (
            <CoverCropDialog
              isOpen={cropOpen}
              onOpenChange={setCropOpen}
              image={cover.image}
              crop={cover.crop}
              onApply={(crop) => uploads.setCrop(cover.key, crop)}
            />
          )}
        </aside>

        <div className={cx(styles.panel, styles.images)} ref={setRef('images')} tabIndex={-1}>
          <ImageUploader
            images={uploads.images}
            coverKey={uploads.coverKey}
            onAddFiles={addFiles}
            onRemove={(key) => {
              uploads.remove(key)
              clearServerError('images')
            }}
            onRetry={(key) => {
              uploads.retry(key)
              clearServerError('images')
            }}
            onRename={uploads.rename}
            onReorder={uploads.reorder}
            onSetCover={uploads.setCover}
            onToggleLive={uploads.setLive}
            errorMessage={errors.images}
            notice={notice}
            headingLevel={isModal ? 3 : 2}
          />
        </div>
      </div>

      <div className={styles.actions}>
        <div className={styles.actionInfo}>
          {formError ? (
            <StaticFieldError>
              <span role="alert">{formError}</span>
            </StaticFieldError>
          ) : (
            <p className={styles.status} aria-live="polite">
              {status}
            </p>
          )}
        </div>
        <div className={styles.buttons}>
          <Button variant="ghost" onPress={cancel} isDisabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" icon={IconDeviceFloppy} isLoading={save.isPending}>
            {isEdit ? t('adminEvents.editor.save') : t('adminEvents.editor.create')}
          </Button>
        </div>
      </div>

      {isModal ? (
        <ConfirmDialog
          isOpen={confirmCancel}
          onOpenChange={setConfirmCancel}
          title={t('adminEvents.editor.unsaved.title')}
          confirmLabel={t('adminEvents.editor.unsaved.confirm')}
          cancelLabel={t('adminEvents.editor.unsaved.stay')}
          onConfirm={onCancel}
        >
          {t('adminEvents.editor.unsaved.message')}
        </ConfirmDialog>
      ) : (
        <UnsavedChangesGuard when={isDirty} allowLeave={allowLeave} />
      )}
    </form>
  )
}

function MissingOptions({
  label,
  message,
  action,
  href,
  errorMessage,
}: {
  label: string
  message: string
  action: string
  href: string
  errorMessage?: string
}) {
  return (
    <div className={styles.missing}>
      <span className={styles.missingLabel}>
        {label}
        <span aria-hidden="true" className={styles.asterisk}>
          *
        </span>
      </span>
      <div className={styles.missingBox}>
        <p>{message}</p>
        <LinkButton href={href} size="sm" variant="secondary">
          {action}
        </LinkButton>
      </div>
      <StaticFieldError>{errorMessage}</StaticFieldError>
    </div>
  )
}

/**
 * Create / edit form of an event: details, ordered categories, images (uploads, order, names,
 * cover) and a live timeline preview. Loads its own data; `variant="modal"` drops the page chrome
 * so it fits inside the event detail modal.
 */
export function EventEditor({ eventId, defaultChildIds, onSaved, onCancel, variant = 'page', onDirtyChange }: EventEditorProps) {
  const { t } = useI18n()
  const errorMessage = useErrorMessage()
  const children = useChildren()
  const categories = useCategories()
  const event = useAdminEvent(eventId)
  const [revision, setRevision] = useState(0)
  const isEdit = eventId !== undefined

  const failed = children.isError ? children.error : categories.isError ? categories.error : isEdit && event.isError ? event.error : null
  if (failed) {
    const missing = isApiError(failed, 'event_not_found') || (isApiError(failed) && failed.status === 404 && failed === event.error)
    return (
      <EmptyState
        icon={missing ? IconCalendarOff : IconAlertTriangle}
        tone={missing ? 'neutral' : 'error'}
        title={missing ? t('adminEvents.editor.notFound.title') : t('adminEvents.editor.loadError')}
        description={missing ? t('adminEvents.editor.notFound.description') : errorMessage(failed)}
        actions={
          <>
            <Button variant="ghost" onPress={onCancel}>
              {t('common.back')}
            </Button>
            {!missing && (
              <Button
                variant="primary"
                icon={IconRefresh}
                onPress={() => {
                  void children.refetch()
                  void categories.refetch()
                  if (isEdit) void event.refetch()
                }}
              >
                {t('common.retry')}
              </Button>
            )}
          </>
        }
      />
    )
  }

  const ready = children.data && categories.data && (!isEdit || (event.data && event.isFetchedAfterMount))
  if (!ready || !children.data || !categories.data) return <LoadingState message={t('common.loading')} />

  const current = isEdit ? (event.data ?? null) : null
  if (current?.deleted_at) {
    return (
      <EmptyState
        icon={IconTrash}
        title={t('adminEvents.editor.inTrash.title')}
        description={t('adminEvents.editor.inTrash.description')}
        actions={
          <>
            <Button variant="ghost" onPress={onCancel}>
              {t('common.back')}
            </Button>
            <LinkButton href="/admin/trash" variant="primary">
              {t('adminEvents.editor.inTrash.action')}
            </LinkButton>
          </>
        }
      />
    )
  }

  const knownChildIds = new Set(children.data.map((child) => child.id))
  const initialChildIds = (defaultChildIds ?? []).filter((id) => knownChildIds.has(id))
  if (initialChildIds.length === 0 && children.data.length === 1) initialChildIds.push(children.data[0].id)

  return (
    <EventForm
      key={`${eventId ?? 'new'}:${revision}`}
      event={current}
      initialChildIds={initialChildIds}
      childList={children.data}
      categoryList={categories.data}
      variant={variant}
      onSaved={onSaved}
      onCancel={onCancel}
      onDirtyChange={onDirtyChange}
      onReload={async () => {
        await event.refetch()
        setRevision((value) => value + 1)
      }}
    />
  )
}
