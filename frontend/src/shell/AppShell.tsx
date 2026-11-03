import { IconSearch, IconX } from '@tabler/icons-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { IconButton } from '../components/IconButton'
import { FAMILY_PATH } from '../contexts/CurrentChildContext'
import { useI18n } from '../i18n'
import { FilterPanelProvider } from '../search/FilterPanelContext'
import { FilterToggleButton } from '../search/FilterToggleButton'
import { SearchBar } from '../search/SearchBar'
import { useIsMobile } from '../utils/useMediaQuery'
import styles from './AppShell.module.css'
import { ChildSwitcher } from './ChildSwitcher'
import { LanguageMenu } from './LanguageMenu'
import { Logo } from './Logo'
import { ThemeMenu } from './ThemeMenu'
import { UserMenu } from './UserMenu'

/**
 * Signed-in app frame: sticky translucent header (brand, child switcher, search + filters on
 * timeline routes, theme, language, account) and the routed page. Mobile: compact header, search
 * expands from an icon, theme/language move into the account panel.
 */
export function AppShell() {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const location = useLocation()
  const onTimeline = location.pathname.startsWith('/c/') || location.pathname === FAMILY_PATH || location.pathname.startsWith(`${FAMILY_PATH}/`)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const mobileSearch = isMobile && onTimeline && searchOpen

  useEffect(() => {
    if (!mobileSearch) return
    const container = searchRef.current
    container?.querySelector('input')?.focus()
    // Esc on an empty field closes the expanded search (the field clears itself first).
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !container?.contains(document.activeElement)) return
      const input = container.querySelector('input')
      if (!input?.value) {
        setSearchOpen(false)
        searchButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileSearch])

  function closeSearch() {
    setSearchOpen(false)
    window.requestAnimationFrame(() => searchButtonRef.current?.focus())
  }

  return (
    <FilterPanelProvider>
      <div className={styles.shell}>
        <a href="#main" className={styles.skip}>
          {t('shell.skipToContent')}
        </a>
        <header className={styles.header}>
          <div className={styles.bar}>
            <div className={styles.start}>
              <Link to="/" className={styles.brand} aria-label={t('shell.home')}>
                <Logo size={isMobile ? 30 : 34} withName={!isMobile} />
              </Link>
              <ChildSwitcher compact={isMobile} />
            </div>
            {onTimeline && !isMobile && (
              <div className={styles.center}>
                <SearchBar />
              </div>
            )}
            <div className={styles.end}>
              {onTimeline && isMobile && (
                <IconButton
                  ref={searchButtonRef}
                  label={t('shell.search.open')}
                  icon={IconSearch}
                  aria-expanded={searchOpen}
                  onPress={() => setSearchOpen(true)}
                />
              )}
              {onTimeline && <FilterToggleButton />}
              {!isMobile && (
                <>
                  <ThemeMenu />
                  <LanguageMenu />
                </>
              )}
              <UserMenu showPreferences={isMobile} />
            </div>
          </div>
          <AnimatePresence>
            {mobileSearch && (
              <motion.div
                ref={searchRef}
                className={styles.mobileSearch}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <div className={styles.mobileSearchField}>
                  <SearchBar />
                </div>
                <IconButton label={t('shell.search.close')} icon={IconX} onPress={closeSearch} tooltip={false} />
              </motion.div>
            )}
          </AnimatePresence>
        </header>
        <main id="main" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </FilterPanelProvider>
  )
}
