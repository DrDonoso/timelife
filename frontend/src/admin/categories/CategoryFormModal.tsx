import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Form } from 'react-aria-components'
import { api } from '../../api/client'
import { qk } from '../../api/queries'
import type { CategoryIn, CategoryOut } from '../../api/schema.gen'
import { Button } from '../../components/Button'
import { ColorInput } from '../../components/ColorInput'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconPicker } from '../../components/IconPicker'
import { Modal } from '../../components/Modal'
import { TextField } from '../../components/TextField'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useFieldErrors, useI18n, type TranslationKey } from '../../i18n'
import { categoryName } from '../../utils/categories'
import { COLOR_PRESETS, normalizeHex } from '../../utils/color'
import styles from './CategoryFormModal.module.css'
import { CategoryPreview } from './CategoryPreview'

export const NAME_MAX_LENGTH = 60
const ICON_PATTERN = /^[a-z0-9-]{1,64}$/

type NameField = 'name_es' | 'name_en' | 'name_pt'
type Field = NameField | 'color' | 'icon'
type Draft = Record<Field, string>
type Errors = Partial<Record<Field, string>>

const FIELDS: readonly Field[] = ['name_es', 'name_en', 'name_pt', 'color', 'icon']

interface NameInput {
  field: NameField
  /** Language the name is written in (its input's `lang`). */
  lang: string
  label: TranslationKey
  placeholder: TranslationKey
  required: TranslationKey
}

/** The three required names, in form order. */
const NAMES: readonly NameInput[] = [
  {
    field: 'name_es',
    lang: 'es',
    label: 'adminCategories.form.nameEs',
    placeholder: 'adminCategories.form.nameEsPlaceholder',
    required: 'adminCategories.form.nameEsRequired',
  },
  {
    field: 'name_en',
    lang: 'en',
    label: 'adminCategories.form.nameEn',
    placeholder: 'adminCategories.form.nameEnPlaceholder',
    required: 'adminCategories.form.nameEnRequired',
  },
  {
    field: 'name_pt',
    lang: 'pt',
    label: 'adminCategories.form.namePt',
    placeholder: 'adminCategories.form.namePtPlaceholder',
    required: 'adminCategories.form.namePtRequired',
  },
]

function initialDraft(category: CategoryOut | null, existing: readonly CategoryOut[]): Draft {
  if (category) {
    const { name_es, name_en, name_pt, color, icon } = category
    return { name_es, name_en, name_pt, color, icon }
  }
  // Suggest a colour that no category uses yet.
  const used = new Set(existing.map((item) => normalizeHex(item.color)))
  const color = COLOR_PRESETS.find((preset) => !used.has(preset)) ?? COLOR_PRESETS[0]
  return { name_es: '', name_en: '', name_pt: '', color, icon: 'star' }
}

export interface CategoryFormModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** Category to edit; `null` creates a new one. */
  category: CategoryOut | null
  /** Current categories (to suggest an unused colour). */
  existing: readonly CategoryOut[]
}

/** Create / edit dialog with live pill, badge and timeline previews on light and dark. */
export function CategoryFormModal({ isOpen, onOpenChange, category, existing }: CategoryFormModalProps) {
  const { t, lang } = useI18n()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const fieldErrors = useFieldErrors()
  const formId = useId()
  const nameRefs: Record<NameField, RefObject<HTMLInputElement | null>> = {
    name_es: useRef<HTMLInputElement>(null),
    name_en: useRef<HTMLInputElement>(null),
    name_pt: useRef<HTMLInputElement>(null),
  }
  const [draft, setDraft] = useState<Draft>(() => initialDraft(category, existing))
  const [initial] = useState(draft)
  const [showErrors, setShowErrors] = useState(false)
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const isDirty = FIELDS.some((field) => draft[field] !== initial[field])

  function validate(values: Draft): Errors {
    const errors: Errors = {}
    for (const { field, required } of NAMES) {
      const name = values[field].trim()
      if (!name) errors[field] = t(required)
      else if (name.length > NAME_MAX_LENGTH) errors[field] = t('adminCategories.form.tooLong', { max: NAME_MAX_LENGTH })
    }
    if (!normalizeHex(values.color)) errors.color = t('adminCategories.form.colorInvalid')
    if (!ICON_PATTERN.test(values.icon)) errors.icon = t('adminCategories.form.iconRequired')
    return errors
  }

  const clientErrors = showErrors ? validate(draft) : {}
  const errors: Errors = { ...serverErrors, ...clientErrors }

  const save = useMutation({
    mutationFn: (body: CategoryIn) =>
      category
        ? api.put<CategoryOut>(`/api/admin/categories/${category.id}`, body)
        : api.post<CategoryOut>('/api/admin/categories', body),
    onSuccess: async (saved) => {
      queryClient.setQueryData<CategoryOut[]>(qk.categories, (list) => {
        if (!list) return list
        return category ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]
      })
      show({
        tone: 'success',
        message: t(category ? 'adminCategories.toast.updated' : 'adminCategories.toast.created', {
          name: categoryName(saved, lang),
        }),
      })
      onOpenChange(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.categories }),
        queryClient.invalidateQueries({ queryKey: ['timeline'] }),
      ])
    },
    onError: (error) => {
      const fields = fieldErrors(error)
      const known = Object.fromEntries(Object.entries(fields).filter(([field]) => (FIELDS as readonly string[]).includes(field)))
      setServerErrors(known)
      setFormError(Object.keys(known).length > 0 ? null : errorMessage(error))
    },
  })

  // Stable (only uses state setters) so the memoised icon grid below doesn't re-render per keystroke.
  const update = useCallback((field: Field, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }, [])

  const iconError = errors.icon
  const iconPicker = useMemo(
    () => (
      <IconPicker
        className={styles.icon}
        label={t('adminCategories.form.icon')}
        value={draft.icon}
        onChange={(icon) => update('icon', icon)}
        color={draft.color}
        errorMessage={iconError}
        isRequired
      />
    ),
    [t, draft.icon, draft.color, iconError, update],
  )

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (save.isPending) return
    setShowErrors(true)
    setFormError(null)
    const found = validate(draft)
    const invalidName = NAMES.find(({ field }) => found[field])
    if (invalidName) {
      nameRefs[invalidName.field].current?.focus()
      return
    }
    if (Object.keys(found).length > 0) return
    save.mutate({
      name_es: draft.name_es.trim(),
      name_en: draft.name_en.trim(),
      name_pt: draft.name_pt.trim(),
      color: normalizeHex(draft.color) ?? draft.color,
      icon: draft.icon,
    })
  }

  const placeholderName = t('adminCategories.preview.placeholderName')
  const preview = {
    name_es: draft.name_es.trim() || placeholderName,
    name_en: draft.name_en.trim() || placeholderName,
    name_pt: draft.name_pt.trim() || placeholderName,
    color: draft.color,
    icon: draft.icon,
  }

  /** Esc, the backdrop, × and Cancel: unsaved changes are only thrown away after confirming. */
  function requestClose() {
    if (save.isPending) return
    if (isDirty) setConfirmDiscard(true)
    else onOpenChange(false)
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onOpenChange={(open) => (open ? onOpenChange(true) : requestClose())}
        title={t(category ? 'adminCategories.form.editTitle' : 'adminCategories.form.createTitle')}
        size="lg"
        fullScreenOnMobile
        isDismissable={!save.isPending}
        footer={
          <>
            <Button variant="ghost" onPress={requestClose} isDisabled={save.isPending}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" type="submit" form={formId} isLoading={save.isPending}>
              {t(category ? 'adminCategories.form.save' : 'adminCategories.form.create')}
            </Button>
          </>
        }
      >
        {formError && (
          <p className={styles.formError} role="alert">
            <IconAlertTriangle size={18} aria-hidden="true" />
            {formError}
          </p>
        )}
        <Form id={formId} validationBehavior="aria" onSubmit={submit} className={styles.form}>
          <div className={styles.names}>
            {NAMES.map(({ field, lang: nameLang, label, placeholder }) => (
              <TextField
                key={field}
                label={t(label)}
                value={draft[field]}
                onChange={(value) => update(field, value)}
                placeholder={t(placeholder)}
                errorMessage={errors[field]}
                isRequired
                maxLength={NAME_MAX_LENGTH}
                inputRef={nameRefs[field]}
                lang={nameLang}
                autoComplete="off"
              />
            ))}
          </div>
          <ColorInput
            className={styles.color}
            label={t('adminCategories.form.color')}
            description={t('adminCategories.form.colorDescription')}
            value={draft.color}
            onChange={(hex) => update('color', hex)}
            presets={COLOR_PRESETS}
            errorMessage={errors.color}
            isRequired
          />
          <CategoryPreview category={preview} className={styles.preview} />
          {iconPicker}
        </Form>
      </Modal>
      <ConfirmDialog
        isOpen={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('admin.discardChanges.title')}
        confirmLabel={t('admin.discardChanges.confirm')}
        cancelLabel={t('admin.discardChanges.stay')}
        onConfirm={() => onOpenChange(false)}
      >
        {t('admin.discardChanges.message')}
      </ConfirmDialog>
    </>
  )
}
