import { IconDeviceDesktop, IconMoon, IconSun, type TablerIcon } from '@tabler/icons-react'
import type { CSSProperties } from 'react'
import {
  Button as AriaButton,
  ToggleButton,
  ToggleButtonGroup,
  TooltipTrigger,
  type Key,
  type Selection,
} from 'react-aria-components'
import { Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger } from '../components/Menu'
import { SegmentedControl } from '../components/SegmentedControl'
import { Tooltip } from '../components/Tooltip'
import { cx, renderIcon } from '../components/utils'
import { useTheme, type ThemePalette, type ThemePreference } from '../contexts/ThemeContext'
import { useI18n } from '../i18n'
import { THEME_PALETTES, THEMES, isThemePalette } from '../theme/themes'
import styles from './ThemeMenu.module.css'

const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']
const MODE_ICONS: Record<ThemePreference, TablerIcon> = { system: IconDeviceDesktop, light: IconSun, dark: IconMoon }

function isPreference(value: Key | undefined): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** The chosen key of a single-selection change. */
function chosenKey(keys: Selection): Key | undefined {
  return keys === 'all' ? undefined : keys.values().next().value
}

export interface PaletteSwatchProps {
  palette: ThemePalette
  className?: string
}

/**
 * A palette as a small circle of its three colours (`THEMES[palette].swatches`). Decorative: its
 * name is always next to it or in the accessible name of the control around it.
 */
export function PaletteSwatch({ palette, className }: PaletteSwatchProps) {
  const [background, primary, accent] = THEMES[palette].swatches
  const style = {
    '--swatch-background': background,
    '--swatch-primary': primary,
    '--swatch-accent': accent,
  } as CSSProperties
  return <span aria-hidden="true" className={cx(styles.swatch, className)} style={style} />
}

/**
 * Header (and sign-in corner) button showing the current palette's swatch and the current mode's
 * sun or moon, named after both («Tema: Atardecer · Modo: Automático»). It opens one menu with two
 * single-choice sections: «Tema» (every palette, with its swatch) and «Modo» (Automático / Claro /
 * Oscuro). Both choices are stored on the device (`timelife.palette`, `timelife.theme`).
 */
export function ThemeMenu() {
  const { t } = useI18n()
  const { preference, resolved, palette, setPreference, setPalette } = useTheme()
  const label = t('shell.themeMenu', { palette: t(`common.palette.${palette}`), mode: t(`common.theme.${preference}`) })
  return (
    <MenuTrigger>
      <TooltipTrigger delay={600} closeDelay={80}>
        <AriaButton aria-label={label} className={styles.trigger}>
          <PaletteSwatch palette={palette} />
          {renderIcon(resolved === 'dark' ? IconMoon : IconSun, 20)}
        </AriaButton>
        <Tooltip placement="bottom">{label}</Tooltip>
      </TooltipTrigger>
      <Menu aria-label={t('common.palette.label')}>
        <MenuSection
          title={t('common.palette.label')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[palette]}
          onSelectionChange={(keys) => {
            const next = chosenKey(keys)
            if (isThemePalette(next)) setPalette(next)
          }}
          className={styles.section}
        >
          {THEME_PALETTES.map((option) => (
            <MenuItem key={option} id={option} icon={<PaletteSwatch palette={option} />}>
              {t(`common.palette.${option}`)}
            </MenuItem>
          ))}
        </MenuSection>
        <MenuSeparator />
        <MenuSection
          title={t('common.theme.label')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[preference]}
          onSelectionChange={(keys) => {
            const next = chosenKey(keys)
            if (isPreference(next)) setPreference(next)
          }}
          className={styles.section}
        >
          {PREFERENCES.map((option) => (
            <MenuItem key={option} id={option} icon={MODE_ICONS[option]}>
              {t(`common.theme.${option}`)}
            </MenuItem>
          ))}
        </MenuSection>
      </Menu>
    </MenuTrigger>
  )
}

export interface PalettePickerProps {
  /** Id of a visible label naming the group (without it, the group is named «Tema»). */
  'aria-labelledby'?: string
  className?: string
}

/**
 * Every palette as a round swatch, radio buttons named after the palettes, the current one ringed:
 * the account panel on phones, where the header has no room for {@link ThemeMenu}. Arrow keys move
 * between the swatches; Space or Enter chooses one.
 */
export function PalettePicker({ 'aria-labelledby': labelledBy, className }: PalettePickerProps) {
  const { t } = useI18n()
  const { palette, setPalette } = useTheme()
  return (
    <ToggleButtonGroup
      aria-label={labelledBy ? undefined : t('common.palette.label')}
      aria-labelledby={labelledBy}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[palette]}
      onSelectionChange={(keys) => {
        const [next] = keys
        if (isThemePalette(next)) setPalette(next)
      }}
      className={cx(styles.picker, className)}
    >
      {THEME_PALETTES.map((option) => (
        <ToggleButton key={option} id={option} aria-label={t(`common.palette.${option}`)} className={styles.pickerOption}>
          <PaletteSwatch palette={option} />
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

/** Compact mode selector (Automático / Claro / Oscuro as icons): the account panel on phones. */
export function ModeSegmented() {
  const { t } = useI18n()
  const { preference, setPreference } = useTheme()
  return (
    <SegmentedControl
      aria-label={t('common.theme.label')}
      size="sm"
      value={preference}
      onChange={setPreference}
      options={PREFERENCES.map((option) => ({
        value: option,
        label: null,
        icon: MODE_ICONS[option],
        'aria-label': t(`common.theme.${option}`),
      }))}
    />
  )
}
