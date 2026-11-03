import { IconCircleCheck, IconInfoCircle, IconX } from '@tabler/icons-react'
import { ApiError } from '../../api/client'
import type { ImportCountsOut, ImportReportOut } from '../../api/schema.gen'
import { Button } from '../../components/Button'
import { useErrorMessage, useI18n } from '../../i18n'
import styles from './BackupPage.module.css'

const ROWS = ['events', 'media', 'children', 'categories', 'users', 'year_colors'] as const

/** What a finished import did: counts per kind of item and the items that failed. */
export function ImportReport({
  report,
  onClose,
  isClosing,
}: {
  report: ImportReportOut
  onClose: () => void
  isClosing?: boolean
}) {
  const { t, formatNumber } = useI18n()
  const errorMessage = useErrorMessage()
  const columns = ['created', 'skipped', 'failed'] as const
  return (
    <div className={styles.stack}>
      <div className={styles.reportHeader} role="status">
        <IconCircleCheck size={22} aria-hidden="true" className={styles.reportIcon} />
        <div>
          <p className={styles.reportTitle}>{t('adminBackup.report.title')}</p>
          <p className={styles.reportMode}>{t(`adminBackup.report.mode.${report.mode}`)}</p>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="visually-hidden">{t('adminBackup.report.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('adminBackup.report.columns.item')}</th>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {t(`adminBackup.report.columns.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const counts: ImportCountsOut = report[row]
              return (
                <tr key={row}>
                  <th scope="row">{t(`adminBackup.report.rows.${row}`)}</th>
                  {columns.map((column) => (
                    <td key={column} data-failed={column === 'failed' && counts.failed > 0 ? true : undefined}>
                      {formatNumber(counts[column])}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {report.issues.length > 0 && (
        <div className={styles.issues}>
          <p className={styles.issuesTitle}>{t('adminBackup.report.issues')}</p>
          <ul>
            {report.issues.map((issue, index) => (
              <li key={`${issue.kind}-${index}`}>
                {t('adminBackup.report.issue', {
                  kind: t(`adminBackup.report.kinds.${issue.kind}`),
                  name: issue.name,
                  reason: errorMessage(new ApiError({ status: 0, code: issue.code })),
                })}
              </li>
            ))}
          </ul>
          {report.more_issues > 0 && <p>{t('adminBackup.report.more', { count: report.more_issues })}</p>}
        </div>
      )}
      {report.media.created > 0 && (
        <p className={styles.note}>
          <IconInfoCircle size={16} aria-hidden="true" /> {t('adminBackup.report.videos')}
        </p>
      )}
      <div className={styles.actions}>
        <Button icon={IconX} isLoading={isClosing} onPress={onClose}>
          {t('adminBackup.report.close')}
        </Button>
      </div>
    </div>
  )
}
