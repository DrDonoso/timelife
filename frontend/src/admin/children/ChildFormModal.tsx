import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useId, useRef, useState, type FormEvent } from 'react'
import { Form } from 'react-aria-components'
import { api, isApiError } from '../../api/client'
import { qk } from '../../api/queries'
import type { ChildIn, ChildOut, ImageOut } from '../../api/schema.gen'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DateField } from '../../components/DateField'
import { Modal } from '../../components/Modal'
import { TextField } from '../../components/TextField'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useFieldErrors, useI18n } from '../../i18n'
import { AvatarField } from './AvatarField'
import styles from './ChildFormModal.module.css'
import { useImageUpload } from './useImageUpload'

export const NAME_MAX_LENGTH = 80
const MIN_BIRTH_DATE = '1900-01-01'

type Field = 'name' | 'birth_date' | 'avatar_image_id'
type Errors = Partial<Record<Field, string>>

export interface ChildFormModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** Child to edit; `null` adds a new one. */
  child: ChildOut | null
}

/**
 * Add / edit a child: name, birth date and photo. Their timeline address (`/c/<slug>`) is not
 * editable: the server makes it from the name when the child is added and never changes it, not
 * even when the child is renamed.
 */
export function ChildFormModal({ isOpen, onOpenChange, child }: ChildFormModalProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const fieldErrors = useFieldErrors()
  const formId = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(child?.name ?? '')
  const [birthDate, setBirthDate] = useState<string | null>(child?.birth_date ?? null)
  const [avatar, setAvatar] = useState<ImageOut | null>(child?.avatar ?? null)
  const [showErrors, setShowErrors] = useState(false)
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const uploader = useImageUpload('avatar', (image) => {
    setAvatar(image)
    clearServerError('avatar_image_id')
  })
  const uploading = uploader.state.status === 'uploading'

  const isDirty =
    name !== (child?.name ?? '') ||
    birthDate !== (child?.birth_date ?? null) ||
    (avatar?.id ?? null) !== (child?.avatar?.id ?? null)

  function validate(): Errors {
    const errors: Errors = {}
    const trimmed = name.trim()
    if (!trimmed) errors.name = t('adminChildren.form.nameRequired')
    else if (trimmed.length > NAME_MAX_LENGTH) errors.name = t('adminChildren.form.tooLong', { max: NAME_MAX_LENGTH })
    if (birthDate && birthDate < MIN_BIRTH_DATE) errors.birth_date = t('adminChildren.form.birthDateInvalid')
    return errors
  }

  const errors: Errors = { ...serverErrors, ...(showErrors ? validate() : {}) }

  function clearServerError(field: Field) {
    setServerErrors((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const save = useMutation({
    mutationFn: (body: ChildIn) =>
      child ? api.put<ChildOut>(`/api/admin/children/${child.id}`, body) : api.post<ChildOut>('/api/admin/children', body),
    onSuccess: async (saved) => {
      queryClient.setQueryData<ChildOut[]>(qk.children, (list) => {
        if (!list) return list
        return child ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]
      })
      show({ tone: 'success', message: t(child ? 'adminChildren.toast.updated' : 'adminChildren.toast.created', { name: saved.name }) })
      onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: qk.children })
    },
    onError: (error) => {
      if (isApiError(error, 'invalid_image') || isApiError(error, 'image_not_found')) {
        setServerErrors({ avatar_image_id: t('adminChildren.avatar.gone') })
        setFormError(null)
        return
      }
      // Any other error (even `slug_taken`, if a same-name child was added meanwhile) is shown above the form.
      const fields = fieldErrors(error)
      const known = Object.fromEntries(
        Object.entries(fields).filter(([field]) => ['name', 'birth_date', 'avatar_image_id'].includes(field)),
      )
      setServerErrors(known)
      setFormError(Object.keys(known).length > 0 ? null : errorMessage(error))
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (save.isPending || uploading) return
    setShowErrors(true)
    setFormError(null)
    const found = validate()
    if (found.name) {
      nameRef.current?.focus()
      return
    }
    if (Object.keys(found).length > 0) return
    save.mutate({ name: name.trim(), birth_date: birthDate, avatar_image_id: avatar?.id ?? null })
  }

  function close() {
    uploader.cancel()
    onOpenChange(false)
  }

  /** Esc, the backdrop, × and Cancel: unsaved changes (or an upload) are only dropped after confirming. */
  function requestClose() {
    if (save.isPending) return
    if (isDirty || uploading) setConfirmDiscard(true)
    else close()
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onOpenChange={(open) => (open ? onOpenChange(true) : requestClose())}
        title={child ? t('adminChildren.form.editTitle', { name: child.name }) : t('adminChildren.form.createTitle')}
        size="md"
        fullScreenOnMobile
        isDismissable={!save.isPending}
        footer={
          <>
            {uploading && <span className={styles.footerHint}>{t('adminChildren.form.waitUpload')}</span>}
            <Button variant="ghost" onPress={requestClose} isDisabled={save.isPending}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" type="submit" form={formId} isLoading={save.isPending} isDisabled={uploading}>
              {t(child ? 'adminChildren.form.save' : 'adminChildren.form.create')}
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
          <AvatarField
            name={name}
            value={avatar}
            original={child?.avatar ?? null}
            onChange={(image) => {
              setAvatar(image)
              clearServerError('avatar_image_id')
            }}
            uploader={uploader}
            errorMessage={errors.avatar_image_id}
          />
          <TextField
            label={t('adminChildren.form.name')}
            value={name}
            onChange={(value) => {
              setName(value)
              clearServerError('name')
            }}
            placeholder={t('adminChildren.form.namePlaceholder')}
            errorMessage={errors.name}
            isRequired
            maxLength={NAME_MAX_LENGTH}
            inputRef={nameRef}
            autoComplete="off"
          />
          <DateField
            label={t('adminChildren.form.birthDate')}
            description={t('adminChildren.form.birthDateHelp')}
            value={birthDate}
            onChange={(value) => {
              setBirthDate(value)
              clearServerError('birth_date')
            }}
            minValue={MIN_BIRTH_DATE}
            errorMessage={errors.birth_date}
          />
        </Form>
      </Modal>
      <ConfirmDialog
        isOpen={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('admin.discardChanges.title')}
        confirmLabel={t('admin.discardChanges.confirm')}
        cancelLabel={t('admin.discardChanges.stay')}
        onConfirm={close}
      >
        {t('admin.discardChanges.message')}
      </ConfirmDialog>
    </>
  )
}
