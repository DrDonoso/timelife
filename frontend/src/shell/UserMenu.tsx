import { IconKey, IconLogout, IconRefresh, IconSettings, IconTimeline } from '@tabler/icons-react'
import { useId, useState } from 'react'
import { Button as AriaButton, Dialog, DialogTrigger, Link, Popover } from 'react-aria-components'
import { useNavigate } from 'react-router'
import { ChangePasswordDialog } from '../auth/ChangePasswordDialog'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import overlay from '../components/Overlay.module.css'
import { cx } from '../components/utils'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useToast } from '../contexts/ToastContext'
import { IS_DEMO } from '../demo/config'
import { useErrorMessage, useI18n } from '../i18n'
import { browserNavigation } from '../utils/navigation'
import { LanguageList } from './LanguageMenu'
import { ModeSegmented, PalettePicker } from './ThemeMenu'
import styles from './UserMenu.module.css'

export interface UserMenuProps {
  /** `admin` swaps the "Administración" link for "Línea de tiempo". */
  context?: 'app' | 'admin'
  /** Include theme, mode and language controls (mobile, where the header has no room for them). */
  showPreferences?: boolean
}

/** Theme (palette swatches), mode and language: the header's menus, in the account panel on phones. */
function Preferences() {
  const { t } = useI18n()
  const { palette } = useTheme()
  const paletteLabel = useId()
  const languageLabel = useId()
  return (
    <div className={styles.preferences}>
      <div className={styles.preferenceList}>
        <div className={styles.preference}>
          <span id={paletteLabel} className={styles.preferenceLabel}>
            {t('common.palette.label')}
          </span>
          {/* The checked swatch already says it. */}
          <span className={styles.preferenceValue} aria-hidden="true">
            {t(`common.palette.${palette}`)}
          </span>
        </div>
        <PalettePicker aria-labelledby={paletteLabel} className={styles.paletteOptions} />
      </div>
      <div className={styles.preference}>
        <span className={styles.preferenceLabel}>{t('common.theme.label')}</span>
        <ModeSegmented />
      </div>
      <div className={styles.preferenceList}>
        <span id={languageLabel} className={styles.preferenceLabel}>
          {t('common.language.label')}
        </span>
        <LanguageList aria-labelledby={languageLabel} className={styles.preferenceOptions} />
      </div>
    </div>
  )
}

/** Avatar button opening the account panel: identity, admin/timeline link, preferences, password, sign out (demo: reset). */
export function UserMenu({ context = 'app', showPreferences = false }: UserMenuProps) {
  const { t } = useI18n()
  const auth = useAuth()
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  if (!auth.user) return null
  const { user } = auth
  const displayName = user.name || user.email
  // The demo has no server to keep a password.
  const canChangePassword = user.has_password && !IS_DEMO

  async function signOut() {
    setSigningOut(true)
    try {
      await auth.logout()
      navigate('/login', { replace: true })
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error) })
      setSigningOut(false)
    }
  }

  return (
    <>
      <DialogTrigger>
        <AriaButton className={styles.trigger} aria-label={`${t('shell.userMenu.label')}: ${displayName}`}>
          <Avatar name={displayName} size={34} decorative />
        </AriaButton>
        <Popover placement="bottom end" offset={8} className={`${overlay.popover} ${styles.popover}`}>
          <Dialog className={styles.dialog} aria-label={t('shell.userMenu.label')}>
            {({ close }) => (
              <>
                <div className={styles.identity}>
                  <Avatar name={displayName} size="lg" decorative />
                  <div className={styles.who}>
                    {user.name && <p className={styles.name}>{user.name}</p>}
                    <p className={styles.email}>{user.email}</p>
                    <span className={styles.role}>{t(`common.roles.${user.role}`)}</span>
                  </div>
                </div>

                {showPreferences && <Preferences />}

                <div className={styles.links}>
                  {context === 'app' && auth.isAdmin && (
                    <Link href="/admin" className={styles.link} onPress={close}>
                      <IconSettings size={18} aria-hidden="true" />
                      {t('shell.userMenu.admin')}
                    </Link>
                  )}
                  {context === 'admin' && (
                    <Link href="/" className={styles.link} onPress={close}>
                      <IconTimeline size={18} aria-hidden="true" />
                      {t('shell.userMenu.timeline')}
                    </Link>
                  )}
                  {canChangePassword && (
                    <AriaButton
                      className={cx(styles.link, styles.linkButton)}
                      onPress={() => {
                        close()
                        setChangingPassword(true)
                      }}
                    >
                      <IconKey size={18} aria-hidden="true" />
                      {t('auth.change.menu')}
                    </AriaButton>
                  )}
                  {IS_DEMO ? (
                    // The demo has no sign-in to leave: a full reload starts it again from its sample data.
                    <Button variant="ghost" icon={IconRefresh} onPress={() => browserNavigation.assign('/')} className={styles.signOut}>
                      {t('demo.reset')}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      icon={IconLogout}
                      isLoading={signingOut}
                      onPress={() => void signOut()}
                      className={styles.signOut}
                    >
                      {t('shell.userMenu.signOut')}
                    </Button>
                  )}
                </div>
              </>
            )}
          </Dialog>
        </Popover>
      </DialogTrigger>
      {canChangePassword && <ChangePasswordDialog isOpen={changingPassword} onOpenChange={setChangingPassword} />}
    </>
  )
}
