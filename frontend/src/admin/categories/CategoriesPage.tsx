import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconCategory, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { api } from '../../api/client'
import { qk, useCategories } from '../../api/queries'
import type { CategoryOut } from '../../api/schema.gen'
import { Button } from '../../components/Button'
import { CategoryPill } from '../../components/CategoryPill'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { IconButton } from '../../components/IconButton'
import { PageHeader } from '../../components/PageHeader'
import { LoadingState } from '../../components/Spinner'
import { useToast } from '../../contexts/ToastContext'
import { CategoryIcon } from '../../icons/CategoryIcon'
import { useErrorMessage, useI18n, type Lang } from '../../i18n'
import { categoryName } from '../../utils/categories'
import { useDocumentTitle } from '../../utils/useDocumentTitle'
import styles from './CategoriesPage.module.css'
import { CategoryFormModal } from './CategoryFormModal'
import { DragHandle, MoveButtons, OrderStatusText, SortableList } from './SortableList'
import { useOrderSaver } from './useOrderSaver'

const RELATED_QUERIES = [['timeline']] as const

/** The names each row shows, with their language tag (Spanish first, in bold). */
const NAME_FIELDS = [
  ['es', 'name_es'],
  ['en', 'name_en'],
  ['pt', 'name_pt'],
] as const satisfies readonly (readonly [Lang, keyof CategoryOut])[]

interface FormTarget {
  /** Remounts the form (fresh state) every time it opens. */
  key: number
  category: CategoryOut | null
}

export function CategoriesPage() {
  const { t, lang } = useI18n()
  useDocumentTitle(t('admin.nav.categories'), t('admin.title'))
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const categories = useCategories()
  const list = categories.data ?? []
  const { reorder, status } = useOrderSaver<CategoryOut>({
    queryKey: qk.categories,
    path: '/api/admin/categories/order',
    related: RELATED_QUERIES,
  })

  const [form, setForm] = useState<FormTarget | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<CategoryOut | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const remove = useMutation({
    mutationFn: (category: CategoryOut) => api.del(`/api/admin/categories/${category.id}`),
    onSuccess: async (_, category) => {
      queryClient.setQueryData<CategoryOut[]>(qk.categories, (current) => current?.filter((item) => item.id !== category.id))
      show({ tone: 'success', message: t('adminCategories.toast.deleted', { name: categoryName(category, lang) }) })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.categories }),
        queryClient.invalidateQueries({ queryKey: ['timeline'] }),
      ])
    },
  })

  function openForm(category: CategoryOut | null) {
    setForm((current) => ({ key: (current?.key ?? 0) + 1, category }))
    setFormOpen(true)
  }

  function askDelete(category: CategoryOut) {
    setDeleting(category)
    setDeleteOpen(true)
  }

  const createButton = (
    <Button variant="primary" icon={IconPlus} onPress={() => openForm(null)}>
      {t('adminCategories.new')}
    </Button>
  )

  let content
  if (categories.isPending) {
    content = <LoadingState message={t('common.loading')} />
  } else if (categories.isError) {
    content = (
      <EmptyState
        tone="error"
        icon={IconAlertTriangle}
        title={t('adminCategories.loadError')}
        description={errorMessage(categories.error)}
        actions={<Button onPress={() => void categories.refetch()}>{t('common.retry')}</Button>}
      />
    )
  } else if (list.length === 0) {
    content = (
      <EmptyState
        icon={IconCategory}
        title={t('adminCategories.empty.title')}
        description={t('adminCategories.empty.description')}
        actions={createButton}
      />
    )
  } else {
    content = (
      <section className={styles.panel} aria-labelledby="categories-list-heading">
        <header className={styles.panelHeader}>
          <div className={styles.panelText}>
            <h2 id="categories-list-heading" className={styles.panelTitle}>
              {t('adminCategories.count', { count: list.length })}
            </h2>
            <p className={styles.panelHint}>{t('adminCategories.reorder.hint')}</p>
          </div>
          <OrderStatusText
            status={status}
            savingLabel={t('adminCategories.reorder.saving')}
            savedLabel={t('adminCategories.reorder.saved')}
            className={styles.panelStatus}
          />
        </header>
        <SortableList
          aria-label={t('adminCategories.listLabel')}
          items={list}
          textValue={(category) => categoryName(category, lang)}
          onReorder={reorder}
          onAction={(category) => openForm(category)}
          describeMove={(category, position, total) =>
            t('adminCategories.reorder.moved', { name: categoryName(category, lang), position, total })
          }
          itemClassName={styles.item}
        >
          {(category, controls) => {
            const name = categoryName(category, lang)
            return (
              <div className={styles.row}>
                <span className={styles.handle}>
                  <DragHandle label={t('adminCategories.row.drag', { name })} />
                </span>
                <span className={styles.pill}>
                  <CategoryPill category={category} />
                </span>
                <span className={styles.names}>
                  {NAME_FIELDS.map(([code, field]) => (
                    <span key={code} className={styles.name} lang={code}>
                      <span className={styles.lang} aria-hidden="true">
                        {code.toUpperCase()}
                      </span>
                      <span className={styles.nameText}>{category[field]}</span>
                    </span>
                  ))}
                </span>
                <span className={styles.meta}>
                  <span className={styles.metaItem}>
                    <span className={styles.swatch} style={{ background: category.color }} aria-hidden="true" />
                    <span className={styles.code}>
                      <span className="visually-hidden">{t('adminCategories.row.color')} </span>
                      {category.color}
                    </span>
                  </span>
                  <span className={styles.metaItem}>
                    <CategoryIcon icon={category.icon} size={18} stroke={1.9} className={styles.metaIcon} />
                    <span className={styles.code}>
                      <span className="visually-hidden">{t('adminCategories.row.icon')} </span>
                      {category.icon}
                    </span>
                  </span>
                </span>
                <span className={styles.actions}>
                  <MoveButtons
                    controls={controls}
                    earlierLabel={t('adminCategories.row.moveUp', { name })}
                    laterLabel={t('adminCategories.row.moveDown', { name })}
                  />
                  <IconButton
                    size="sm"
                    icon={IconPencil}
                    label={t('adminCategories.row.edit', { name })}
                    onPress={() => openForm(category)}
                  />
                  <IconButton
                    size="sm"
                    variant="danger"
                    icon={IconTrash}
                    label={t('adminCategories.row.delete', { name })}
                    onPress={() => askDelete(category)}
                  />
                </span>
              </div>
            )
          }}
        </SortableList>
      </section>
    )
  }

  return (
    <>
      <PageHeader
        icon={IconCategory}
        title={t('admin.nav.categories')}
        description={t('adminCategories.description')}
        actions={list.length > 0 ? createButton : undefined}
      />
      {content}
      {form && (
        <CategoryFormModal
          key={form.key}
          isOpen={formOpen}
          onOpenChange={setFormOpen}
          category={form.category}
          existing={list}
        />
      )}
      <ConfirmDialog
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('adminCategories.delete.title', { name: deleting ? categoryName(deleting, lang) : '' })}
        confirmLabel={t('adminCategories.delete.confirm')}
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      >
        {t('adminCategories.delete.message')}
      </ConfirmDialog>
    </>
  )
}
