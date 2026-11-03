import {
  IconAlertTriangle,
  IconFileZip,
  IconInfoCircle,
  IconPlayerStop,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileTrigger, Label, ProgressBar, Radio, RadioGroup, Text } from 'react-aria-components'
import { ApiError, isAbortError } from '../../api/client'
import type { ImportOut } from '../../api/schema.gen'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { LoadingState } from '../../components/Spinner'
import { cx } from '../../components/utils'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../../i18n'
import { formatBytes } from '../../utils/bytes'
import { BackupContents } from './BackupContents'
import {
  type ImportMode,
  useCancelImport,
  useCreateImport,
  useDiscardImport,
  useImportSession,
  useSetImport,
  useStartImport,
} from './backupApi'
import styles from './BackupPage.module.css'
import { isSameFile, uploadArchive } from './chunkedUpload'
import { ImportReport } from './ImportReport'

const ZIP_TYPES = ['.zip', 'application/zip', 'application/x-zip-compressed']
const MODES: readonly ImportMode[] = ['merge', 'replace']

interface Upload {
  name: string
  sent: number
  size: number
}

export function Notice({
  tone,
  children,
  actions,
}: {
  tone: 'info' | 'warning' | 'error'
  children: ReactNode
  actions?: ReactNode
}) {
  const Icon = tone === 'info' ? IconInfoCircle : IconAlertTriangle
  return (
    <div className={styles.notice} data-tone={tone} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={18} aria-hidden="true" className={styles.noticeIcon} />
      <div className={styles.noticeText}>{children}</div>
      {actions && <div className={styles.noticeActions}>{actions}</div>}
    </div>
  )
}

function Progress({ label, value, total, text }: { label: string; value: number; total: number | null; text?: string }) {
  const indeterminate = total === null || total <= 0
  return (
    <ProgressBar
      className={styles.progress}
      value={indeterminate ? undefined : value}
      minValue={0}
      maxValue={indeterminate ? 100 : total}
      isIndeterminate={indeterminate}
      valueLabel={text}
    >
      {({ percentage }) => (
        <>
          <div className={styles.progressHeader}>
            <Label className={styles.progressLabel}>{label}</Label>
            {text && <span className={styles.progressValue}>{text}</span>}
          </div>
          <div className={styles.track}>
            <div
              className={cx(styles.fill, indeterminate && styles.indeterminate)}
              style={indeterminate ? undefined : { width: `${percentage ?? 0}%` }}
            />
          </div>
        </>
      )}
    </ProgressBar>
  )
}

function ZipPicker({ label, onFile, isDisabled }: { label: string; onFile: (file: File) => void; isDisabled?: boolean }) {
  return (
    <FileTrigger
      acceptedFileTypes={ZIP_TYPES}
      onSelect={(files) => {
        const file = files?.[0]
        if (file) onFile(file)
      }}
    >
      <Button variant="primary" icon={IconUpload} isDisabled={isDisabled}>
        {label}
      </Button>
    </FileTrigger>
  )
}

/** The import card: upload a backup in pieces, choose how to import it, follow the run. */
export function ImportSection() {
  const { t, formatDate, formatNumber } = useI18n()
  const errorMessage = useErrorMessage()
  const toast = useToast()
  const queryClient = useQueryClient()
  const query = useImportSession()
  const session = query.data ?? null
  const setImport = useSetImport()
  const create = useCreateImport()
  const start = useStartImport()
  const cancel = useCancelImport()
  const discard = useDiscardImport()
  const [upload, setUpload] = useState<Upload | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const uploads = useRef<AbortController | null>(null)
  // Set when the administrator cancels the upload (leaving the page keeps it to resume later).
  const cancelling = useRef(false)
  const status = session?.status
  const lastStatus = useRef(status)
  const uploading = upload !== null
  const bytes = (value: number) => formatBytes(formatNumber, value)
  // Message of an error code kept in the session (why it is invalid, why the last run stopped).
  const reason = (code: string | null) => errorMessage(new ApiError({ status: 0, code: code ?? 'unknown' }))

  // Leaving the page stops the upload; choosing the same file later goes on where it stopped.
  useEffect(() => {
    const controller = uploads
    return () => controller.current?.abort()
  }, [])

  useEffect(() => {
    if (!uploading) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploading])

  useEffect(() => {
    const previous = lastStatus.current
    lastStatus.current = status
    // Anything may have changed: every cached query (timeline, children, users…) is refreshed.
    if (previous === 'running' && status === 'finished') void queryClient.invalidateQueries()
  }, [status, queryClient])

  async function send(file: File) {
    setProblem(null)
    if (session?.status === 'uploading' && !isSameFile(session, file)) {
      setProblem(t('adminBackup.import.otherFile', { name: session.filename }))
      return
    }
    const controller = new AbortController()
    uploads.current = controller
    cancelling.current = false
    setUpload({ name: file.name, sent: session?.received ?? 0, size: file.size })
    let target: ImportOut | null = session?.status === 'uploading' ? session : null
    try {
      target ??= await create.mutateAsync({ filename: file.name, size: file.size, last_modified: file.lastModified })
      if (!controller.signal.aborted) {
        const done = await uploadArchive({
          file,
          session: target,
          signal: controller.signal,
          onProgress: (sent) => setUpload((current) => current && { ...current, sent }),
        })
        setImport(done)
      }
    } catch (error) {
      if (!isAbortError(error)) {
        setProblem(errorMessage(error))
        void query.refetch()
      }
    } finally {
      if (uploads.current === controller) uploads.current = null
      setUpload(null)
    }
    // Cancelled by the administrator (not by leaving the page): the half-sent file goes away.
    if (cancelling.current && target) {
      cancelling.current = false
      const id = target.id
      await act(() => discard.mutateAsync(id))
    }
  }

  async function act(action: () => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error) })
    }
  }

  function stopUpload() {
    cancelling.current = true
    uploads.current?.abort()
  }

  let content: ReactNode
  if (upload) {
    content = (
      <div className={styles.stack}>
        <Progress
          label={t('adminBackup.import.uploading', { name: upload.name })}
          value={upload.sent}
          total={upload.size}
          text={t('adminBackup.import.uploaded', { sent: bytes(upload.sent), size: bytes(upload.size) })}
        />
        <div className={styles.actions}>
          <Button variant="ghost" icon={IconX} onPress={stopUpload}>
            {t('adminBackup.import.cancelUpload')}
          </Button>
        </div>
      </div>
    )
  } else if (query.isPending) {
    content = <LoadingState message={t('common.loading')} />
  } else if (query.isError) {
    content = (
      <Notice
        tone="error"
        actions={
          <Button size="sm" onPress={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        }
      >
        {t('adminBackup.import.loadError')} {errorMessage(query.error)}
      </Notice>
    )
  } else if (!session) {
    content = (
      <div className={styles.actions}>
        <ZipPicker label={t('adminBackup.import.choose')} onFile={(file) => void send(file)} isDisabled={create.isPending} />
      </div>
    )
  } else if (session.status === 'uploading') {
    content = (
      <Notice
        tone="info"
        actions={
          <>
            <ZipPicker label={t('adminBackup.import.resume.action')} onFile={(file) => void send(file)} />
            <Button
              variant="ghost"
              icon={IconTrash}
              isLoading={discard.isPending}
              onPress={() => void act(() => discard.mutateAsync(session.id))}
            >
              {t('adminBackup.import.discard')}
            </Button>
          </>
        }
      >
        <strong>{t('adminBackup.import.resume.title')}</strong>
        <p>
          {t('adminBackup.import.resume.description', {
            name: session.filename,
            received: bytes(session.received),
            size: bytes(session.size),
          })}
        </p>
      </Notice>
    )
  } else if (session.status === 'invalid') {
    content = (
      <Notice
        tone="error"
        actions={
          <Button
            variant="secondary"
            icon={IconTrash}
            isLoading={discard.isPending}
            onPress={() => void act(() => discard.mutateAsync(session.id))}
          >
            {t('adminBackup.import.discard')}
          </Button>
        }
      >
        <strong>{t('adminBackup.import.invalid', { name: session.filename })}</strong>
        <p>{reason(session.error)}</p>
      </Notice>
    )
  } else if (session.status === 'ready' && session.archive) {
    const archive = session.archive
    const exported = formatDate(archive.exported_at, 'long')
    content = (
      <div className={styles.stack}>
        <div className={styles.archive}>
          <IconFileZip size={22} aria-hidden="true" className={styles.archiveIcon} />
          <div className={styles.archiveText}>
            <p className={styles.archiveTitle}>{t('adminBackup.import.archive.title', { date: exported })}</p>
            <p className={styles.archiveMeta}>
              {session.filename} · {bytes(session.size)}
              {archive.app_version && <> · {t('adminBackup.import.archive.version', { version: archive.app_version })}</>}
            </p>
          </div>
        </div>
        <BackupContents summary={archive.summary} label={t('adminBackup.import.archive.contents')} />
        {archive.missing_files > 0 && (
          <Notice tone="warning">{t('adminBackup.import.archive.missing', { count: archive.missing_files })}</Notice>
        )}
        {session.error && (
          <Notice tone="warning">
            {t('adminBackup.import.previousError', { reason: reason(session.error) })}
          </Notice>
        )}
        <RadioGroup
          className={styles.modes}
          value={mode}
          onChange={(value) => setMode(value as ImportMode)}
          isDisabled={start.isPending}
        >
          <Label className={styles.modesLabel}>{t('adminBackup.import.mode.label')}</Label>
          {MODES.map((value) => (
            <Radio key={value} value={value} className={styles.mode} data-mode={value}>
              <span className={styles.modeTitle}>{t(`adminBackup.import.mode.${value}.title`)}</span>
              <Text slot="description" className={styles.modeDescription}>
                {t(`adminBackup.import.mode.${value}.description`)}
              </Text>
            </Radio>
          ))}
        </RadioGroup>
        <div className={styles.actions}>
          <Button
            variant={mode === 'replace' ? 'danger' : 'primary'}
            icon={IconUpload}
            isLoading={start.isPending}
            onPress={() => {
              if (mode === 'replace') setConfirmOpen(true)
              else void act(() => start.mutateAsync({ id: session.id, mode }))
            }}
          >
            {t('adminBackup.import.start')}
          </Button>
          <Button
            variant="ghost"
            icon={IconTrash}
            isDisabled={start.isPending}
            isLoading={discard.isPending}
            onPress={() => void act(() => discard.mutateAsync(session.id))}
          >
            {t('adminBackup.import.discard')}
          </Button>
        </div>
        <ConfirmDialog
          isOpen={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('adminBackup.import.confirm.title')}
          confirmLabel={t('adminBackup.import.confirm.action')}
          onConfirm={() => start.mutateAsync({ id: session.id, mode: 'replace' })}
        >
          {t('adminBackup.import.confirm.message', { date: exported })}
        </ConfirmDialog>
      </div>
    )
  } else if (session.status === 'running') {
    const progress = session.progress
    const saving = progress?.phase === 'saving'
    content = (
      <div className={styles.stack}>
        <Progress
          label={t(saving ? 'adminBackup.import.running.saving' : 'adminBackup.import.running.media')}
          value={progress?.done ?? 0}
          total={saving || !progress?.total ? null : progress.total}
          text={
            !saving && progress?.total
              ? t('adminBackup.import.running.progress', { done: progress.done, total: progress.total })
              : undefined
          }
        />
        <p className={styles.note}>{t('adminBackup.import.running.note')}</p>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            icon={IconPlayerStop}
            isDisabled={saving}
            isLoading={cancel.isPending}
            onPress={() => void act(() => cancel.mutateAsync(session.id))}
          >
            {t('adminBackup.import.cancel')}
          </Button>
        </div>
      </div>
    )
  } else if (session.status === 'finished' && session.report) {
    content = (
      <ImportReport
        report={session.report}
        onClose={() => void act(() => discard.mutateAsync(session.id))}
        isClosing={discard.isPending}
      />
    )
  }

  return (
    <section className={styles.card} aria-labelledby="backup-import-title">
      <header className={styles.cardHeader}>
        <h2 id="backup-import-title" className={styles.cardTitle}>
          {t('adminBackup.import.title')}
        </h2>
        <p className={styles.cardDescription}>{t('adminBackup.import.description')}</p>
      </header>
      <div className={styles.cardBody}>
        {problem && <Notice tone="error">{problem}</Notice>}
        {content}
      </div>
    </section>
  )
}
