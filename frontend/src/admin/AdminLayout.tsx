import {
  IconArrowLeft,
  IconCalendarEvent,
  IconCategory,
  IconDatabaseExport,
  IconMenu2,
  IconMoodKid,
  IconPalette,
  IconTrash,
  IconUsers,
  type TablerIcon,
} from '@tabler/icons-react'
import { motion } from 'motion/react'
import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { useVersion } from '../api/queries'
import { Drawer } from '../components/Drawer'
import { IconButton } from '../components/IconButton'
import { LoadingState } from '../components/Spinner'
import { cx, renderIcon } from '../components/utils'
import { useI18n } from '../i18n'
import { LanguageMenu } from '../shell/LanguageMenu'
import { Logo } from '../shell/Logo'
import { ThemeMenu } from '../shell/ThemeMenu'
import { UserMenu } from '../shell/UserMenu'
import { useIsMobile } from '../utils/useMediaQuery'
import styles from './AdminLayout.module.css'

type NavKey = 'events' | 'categories' | 'children' | 'appearance' | 'users' | 'trash' | 'backup'

const NAV: ReadonlyArray<{ key: NavKey; to: string; icon: TablerIcon }> = [
  { key: 'events', to: '/admin/events', icon: IconCalendarEvent },
  { key: 'categories', to: '/admin/categories', icon: IconCategory },
  { key: 'children', to: '/admin/children', icon: IconMoodKid },
  { key: 'appearance', to: '/admin/appearance', icon: IconPalette },
  { key: 'users', to: '/admin/users', icon: IconUsers },
  { key: 'trash', to: '/admin/trash', icon: IconTrash },
  { key: 'backup', to: '/admin/backup', icon: IconDatabaseExport },
]

function VersionFooter() {
  const { t, formatDate } = useI18n()
  const version = useVersion()
  if (!version.data) return null
  const { version: tag, build_date: buildDate } = version.data
  const date = buildDate ? formatDate(buildDate, 'medium') : ''
  return (
    <p className={styles.version}>
      {date ? t('admin.versionWithDate', { version: tag, date }) : t('admin.version', { version: tag })}
    </p>
  )
}

function SidebarContent({ onNavigate, inDrawer = false }: { onNavigate?: () => void; inDrawer?: boolean }) {
  const { t } = useI18n()
  return (
    <div className={styles.sidebarInner}>
      {!inDrawer && (
        <Link to="/admin" className={styles.brand} aria-label={t('admin.title')}>
          <Logo size={34} withName />
        </Link>
      )}
      <p className={styles.sectionLabel} aria-hidden="true">
        {t('admin.title')}
      </p>
      <nav aria-label={t('admin.nav.label')}>
        <ul role="list" className={styles.navList}>
          {NAV.map((item) => (
            <li key={item.key}>
              <NavLink to={item.to} className={styles.navLink} onClick={onNavigate}>
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId={inDrawer ? 'admin-nav-active-drawer' : 'admin-nav-active'}
                        className={styles.activeBg}
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      />
                    )}
                    <span className={styles.navIcon}>{renderIcon(item.icon, 20)}</span>
                    <span className={styles.navText}>{t(`admin.nav.${item.key}`)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.sidebarFooter}>
        <Link to="/" className={styles.back} onClick={onNavigate}>
          <IconArrowLeft size={18} aria-hidden="true" />
          {t('admin.backToTimeline')}
        </Link>
        <VersionFooter />
      </div>
    </div>
  )
}

/** Admin frame: sidebar (desktop) or top bar + drawer (mobile), account controls, lazy pages. */
export function AdminLayout() {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className={styles.layout}>
      <a href="#admin-main" className={styles.skip}>
        {t('shell.skipToContent')}
      </a>
      {!isMobile && (
        <aside className={styles.sidebar}>
          <SidebarContent />
        </aside>
      )}
      <div className={styles.content}>
        <header className={cx(styles.topbar, isMobile && styles.topbarMobile)}>
          {isMobile && (
            <>
              <IconButton
                label={t('admin.openMenu')}
                icon={IconMenu2}
                aria-expanded={drawerOpen}
                onPress={() => setDrawerOpen(true)}
              />
              <Link to="/admin" className={styles.mobileBrand} aria-label={t('admin.title')}>
                <Logo size={28} />
                <span className={styles.mobileTitle}>{t('admin.title')}</span>
              </Link>
            </>
          )}
          <div className={styles.topbarEnd}>
            {!isMobile && (
              <>
                <ThemeMenu />
                <LanguageMenu />
              </>
            )}
            <UserMenu context="admin" showPreferences={isMobile} />
          </div>
        </header>
        <main id="admin-main" className={styles.main} tabIndex={-1}>
          <div className={styles.container}>
            <Suspense fallback={<LoadingState fill />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      {isMobile && (
        <Drawer isOpen={drawerOpen} onOpenChange={setDrawerOpen} side="left" title={<Logo size={30} withName />} aria-label={t('admin.title')}>
          {(close) => <SidebarContent onNavigate={close} inDrawer />}
        </Drawer>
      )}
    </div>
  )
}
