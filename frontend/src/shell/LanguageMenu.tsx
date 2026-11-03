import { IconCheck, IconLanguage } from '@tabler/icons-react'
import { Button as AriaButton, ToggleButton, ToggleButtonGroup, TooltipTrigger, type Key } from 'react-aria-components'
import { Menu, MenuItem, MenuTrigger } from '../components/Menu'
import { Tooltip } from '../components/Tooltip'
import { cx, renderIcon } from '../components/utils'
import { LANGS, useI18n, type Lang } from '../i18n'
import styles from './LanguageMenu.module.css'

function isLang(value: Key | undefined): value is Lang {
  return LANGS.some((lang) => lang === value)
}

/**
 * Header (and sign-in corner) button with the language icon and the current language's code
 * ("ES"), opening a menu of every language, each named in itself: Español, English, Português.
 * Choosing one persists `timelife.lang` and updates `<html lang>`.
 */
export function LanguageMenu() {
  const { t, lang, setLang } = useI18n()
  const label = t('shell.languageMenu', { language: t(`common.language.${lang}`) })
  return (
    <MenuTrigger>
      <TooltipTrigger delay={600} closeDelay={80}>
        <AriaButton aria-label={label} className={styles.trigger}>
          {renderIcon(IconLanguage, 20)}
          {/* The accessible name already says it ("Idioma: Español"). */}
          <span aria-hidden="true">{lang.toUpperCase()}</span>
        </AriaButton>
        <Tooltip placement="bottom">{label}</Tooltip>
      </TooltipTrigger>
      <Menu
        aria-label={t('common.language.label')}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[lang]}
        onSelectionChange={(keys) => {
          if (keys === 'all') return
          const [next] = keys
          if (isLang(next)) setLang(next)
        }}
      >
        {LANGS.map((option) => (
          <MenuItem key={option} id={option} lang={option}>
            {t(`common.language.${option}`)}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  )
}

export interface LanguageListProps {
  /** Id of a visible label naming the list (without it, the list is named «Idioma»). */
  'aria-labelledby'?: string
  className?: string
}

/**
 * Every language as a list of radio buttons, each named in itself, the current one checked: the
 * account panel on phones, where the header has no room for {@link LanguageMenu}. Arrow keys move
 * between the languages; Space or Enter chooses one.
 */
export function LanguageList({ 'aria-labelledby': labelledBy, className }: LanguageListProps) {
  const { t, lang, setLang } = useI18n()
  return (
    <ToggleButtonGroup
      aria-label={labelledBy ? undefined : t('common.language.label')}
      aria-labelledby={labelledBy}
      orientation="vertical"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[lang]}
      onSelectionChange={(keys) => {
        const [next] = keys
        if (isLang(next)) setLang(next)
      }}
      className={cx(styles.list, className)}
    >
      {LANGS.map((option) => (
        <ToggleButton key={option} id={option} lang={option} className={styles.option}>
          {({ isSelected }) => (
            <>
              <span className={styles.name}>{t(`common.language.${option}`)}</span>
              <span className={styles.check}>{isSelected && <IconCheck size={16} stroke={2.4} aria-hidden="true" />}</span>
            </>
          )}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
