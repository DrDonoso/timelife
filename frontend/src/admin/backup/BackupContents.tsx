import type { BackupSummaryOut } from '../../api/schema.gen'
import { useI18n } from '../../i18n'
import { formatBytes } from '../../utils/bytes'
import styles from './BackupPage.module.css'

/** What a backup holds, as short items ("120 hitos", "3 en la papelera", "≈ 6,2 GB"…). */
export function BackupContents({ summary, label }: { summary: BackupSummaryOut; label: string }) {
  const { t, formatNumber } = useI18n()
  const photos = t('adminBackup.summary.photos', { count: summary.photos })
  const users = t('adminBackup.summary.users', { count: summary.users })
  const items = [
    t('adminBackup.summary.events', { count: summary.events }),
    summary.trashed_events > 0 && t('adminBackup.summary.trashed', { count: summary.trashed_events }),
    summary.live_photos > 0 ? `${photos} (${t('adminBackup.summary.livePhotos', { count: summary.live_photos })})` : photos,
    t('adminBackup.summary.videos', { count: summary.videos }),
    t('adminBackup.summary.children', { count: summary.children }),
    t('adminBackup.summary.categories', { count: summary.categories }),
    summary.admins > 0 ? `${users} (${t('adminBackup.summary.admins', { count: summary.admins })})` : users,
    summary.year_colors > 0 && t('adminBackup.summary.yearColors', { count: summary.year_colors }),
    summary.background && t('adminBackup.summary.background'),
    t('adminBackup.size', { size: formatBytes(formatNumber, summary.media_bytes) }),
  ].filter((item): item is string => Boolean(item))
  return (
    <ul className={styles.contents} aria-label={label}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}
