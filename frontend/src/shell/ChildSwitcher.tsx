import { IconChevronDown, IconUsersGroup } from '@tabler/icons-react'
import { Button as AriaButton } from 'react-aria-components'
import { useLocation, useNavigate } from 'react-router'
import { Avatar, AvatarGroup } from '../components/Avatar'
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../components/Menu'
import { FAMILY_CHOICE, FAMILY_PATH, useCurrentChild } from '../contexts/CurrentChildContext'
import { useI18n } from '../i18n'
import styles from './ChildSwitcher.module.css'

/**
 * Current timeline (the child's avatar and name, or every child's for "All together"); a menu to
 * switch when there is more than one child, ending with the family timeline.
 */
export function ChildSwitcher({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const { children, child, isAll } = useCurrentChild()
  const navigate = useNavigate()
  const location = useLocation()
  if (!child && !isAll) return null

  const name = isAll ? t('shell.childSwitcher.all') : (child?.name ?? '')
  const content = (
    <>
      {isAll ? (
        <AvatarGroup
          people={children.map((item) => ({ id: item.id, name: item.name, image: item.avatar }))}
          max={3}
          size={compact ? 26 : 30}
          label={name}
        />
      ) : (
        child && <Avatar name={child.name} image={child.avatar} size={compact ? 30 : 34} decorative ring />
      )}
      <span className={styles.name}>{name}</span>
    </>
  )

  if (children.length <= 1 && !isAll) {
    return (
      <div className={styles.single} title={t('shell.childSwitcher.current', { name })}>
        {content}
      </div>
    )
  }

  function switchTo(pathname: string) {
    // Filters and zoom carry over; the focused node belongs to the previous timeline.
    const params = new URLSearchParams(location.search)
    params.delete('focus')
    const search = params.toString()
    navigate({ pathname, search: search ? `?${search}` : '' })
  }

  const current = isAll ? FAMILY_CHOICE : (child?.slug ?? '')
  return (
    <MenuTrigger>
      <AriaButton className={styles.trigger} aria-label={`${t('shell.childSwitcher.label')}: ${name}`}>
        {content}
        <IconChevronDown size={16} stroke={2.4} aria-hidden="true" className={styles.chevron} />
      </AriaButton>
      <Menu
        aria-label={t('shell.childSwitcher.label')}
        placement="bottom start"
        selectionMode="single"
        selectedKeys={[current]}
        onSelectionChange={(keys) => {
          if (keys === 'all') return
          const [key] = keys
          if (typeof key !== 'string' || key === current) return
          switchTo(key === FAMILY_CHOICE ? FAMILY_PATH : `/c/${key}`)
        }}
      >
        {children.map((item) => (
          <MenuItem key={item.id} id={item.slug} textValue={item.name} icon={<Avatar name={item.name} image={item.avatar} size={28} decorative />}>
            {item.name}
          </MenuItem>
        ))}
        {children.length > 1 && <MenuSeparator />}
        {children.length > 1 && (
          <MenuItem
            id={FAMILY_CHOICE}
            textValue={t('shell.childSwitcher.all')}
            icon={IconUsersGroup}
            description={t('shell.childSwitcher.allDescription')}
          >
            {t('shell.childSwitcher.all')}
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  )
}
