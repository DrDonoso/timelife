# Timelife design system

Shared UI for every feature. Import from `src/components` (barrel) or the component file:

```tsx
import { Button, Modal, CategoryPill } from '../components'
```

Rules: style with **CSS Modules** and the **tokens** in `src/styles/tokens.css` (never hard-coded colours);
react-aria-components for behaviour/accessibility; Motion (`motion/react`) for polish; every visible string
comes from i18n (`useI18n().t('ns.key')`). Icons: `@tabler/icons-react` components (`IconPlus`) or, for
categories, `<CategoryIcon icon="baby-bottle" />`.

## Tokens & globals (`src/styles`)

- Colours: `--color-bg --color-bg-elevated --color-surface --color-surface-2 --color-surface-3 --color-border
  --color-border-strong --color-text --color-text-muted --color-text-subtle --color-primary --color-primary-hover
  --color-primary-contrast --color-primary-soft --color-primary-soft-text --color-focus --color-danger
  (-hover/-soft/-contrast) --color-success(-soft) --color-warning(-soft) --color-line --color-overlay
  --color-hub-badge-bg --color-tooltip-bg/-text`. Brand: `--brand-gold --brand-coral --brand-rose
  --gradient-brand --gradient-brand-soft --gradient-brand-text`.
- Shape/space/type/motion: `--radius-sm|md|lg|xl|pill`, `--space-1..8` (4 8 12 16 24 32 48 64 px),
  `--font-sans --font-display`, `--text-xs..3xl`, `--shadow-sm|md|lg`, `--z-header|panel|modal|popover|toast`,
  `--header-height` (64 / 56 px mobile), `--duration-fast|normal|slow`, `--ease-out`, `--ease-bounce`.
- Backgrounds: `--pattern-image` + `--pattern-size` (soft dots & sparkles, tinted per palette) and
  `--background-glow` (3 radial layers):
  `background-image: var(--background-glow), var(--pattern-image); background-size: auto, auto, auto, var(--pattern-size);`
- Mode and palette = `<html data-theme="light|dark" data-palette="sunset|ocean|forest|lavender|graphite">`
  (handled by `ThemeProvider`; `public/theme-init.js` applies the saved ones before the first paint). Sunset's
  colour tokens are in `tokens.css`, the other palettes' in `themes.css`; every palette and mode declares every
  colour token. An element that forces a mode (a light preview inside a dark page) carries both `data-palette`
  and `data-theme` and wraps its content in `<ThemeScope mode="light">` (see `CategoryPreview`). Mobile
  breakpoint `max-width: 767px` (`useIsMobile()` in JS). Global utility: `.visually-hidden`.

## Colour utilities (`src/utils/color.ts`) and palettes (`src/theme`)

`normalizeHex`, `hexToRgb`, `relativeLuminance`, `contrastRatio(a, b)`, `ensureContrast(bg, fg = '#fff', min = 4.5)`
(moves `bg` along OKLCH lightness until `fg` reaches `min`; darkens for light `fg`, lightens for dark `fg`),
`readableText(bg, large?)`, `hexToOklch`, `oklchToHex` (gamut-clamped), `adaptColor(hex, tone)` (clamps OKLCH
lightness into `tone.lightness` and scales chroma, same hue; no tone = as chosen), `monthColor(yearHex, month)`,
`hubFill(hex)`, `segmentedRing(colors)`, `segmentedBorder(colors)`, `withAlpha(hex, a)`, `shiftLightness`,
`COLOR_PRESETS`, `NEUTRAL_COLOR`, `DARK_TEXT`; `YEAR_PALETTE`, `autoYearColor(year)` and `yearColor(year, overrides)`
are the default (sunset) palette's.
Palettes: `THEME_PALETTES`, `DEFAULT_PALETTE`, `isThemePalette`, `THEMES[id]` (`swatches` for pickers, `background`
and `hubBadge` per mode, 10 automatic `years`, 8 automatic `lanes`, `tone` per mode) in `src/theme/themes.ts`.
Paint category colours, year colours and the family timeline's lane colours through `useThemeColors()`
(`src/theme/useThemeColors.ts`): `{ palette, mode, adapt(hex), autoYear(year), year(year, overrides), lane(index, own),
hubBadgeBg }`, memoised per palette and mode (`getThemeColors(palette, mode)` outside React). Stored values and colour
inputs keep the raw colours; only the painting is adapted (sunset paints them as chosen).
Dates: `src/utils/dates.ts` (`parseISODate`, `toISODate`, `todayISO`, `isISODate`, `shiftISODate`, …).
Categories: `categoryName(category, lang)`, `categoriesById`, `pickCategories(ids, byId)` (keeps order).

## Components

| Component | Key props | Notes |
|---|---|---|
| `Button` | `variant` primary·secondary(default)·ghost·danger, `size` sm·md·lg, `icon`, `iconEnd`, `isLoading`, `fullWidth`, react-aria `onPress`, `type`, `isDisabled` | `LinkButton` = same look with `href` (client-side navigation). |
| `IconButton` | **`label`** (aria-label + tooltip), `icon`, `variant` ghost·secondary·primary·danger·overlay, `size`, `badge`, `tooltip`, `isLoading` | `overlay` = dark glass for buttons over photos. Put state in `label` ("Filtros (2)"). |
| `Modal` | `isOpen`, `onOpenChange`, `title` or `aria-label`, `size` sm·md·lg·xl, `fullScreenOnMobile`, `swipeToClose`, `footer`, `bleed`, `originRect`, `isDismissable`, `hideCloseButton`, `role` | Children/footer may be `(close) => …`. `originRect` = screen rect it grows from / shrinks to. Without a title the close button floats. `swipeToClose`: full screen on a phone, pulling the panel down from the top of its content closes it. |
| `ConfirmDialog` | `isOpen`, `onOpenChange`, `title`, children (message), `onConfirm`, `tone` danger·primary, `confirmLabel`, `isPending` | If `onConfirm` returns a promise it shows a spinner, closes on success and shows the translated error on failure. |
| `Drawer` | `isOpen`, `onOpenChange`, `side` left·right, `title`/`aria-label`, `width` | Full-height modal side panel (mobile nav, mobile filters). |
| `Spinner` / `LoadingState` | `size`, `label`, `decorative` / `message`, `fill`, `overlay` | `LoadingState` fades in after 250 ms; `overlay` floats it in a card over the page (Suspense fallback of lazy overlay routes). |
| `EmptyState` | `icon`, `title`, `description`, `actions`, `tone` neutral·error, `size`, `headingLevel` | Centres itself in flex columns. |
| `PageHeader` | `title`, `description`, `icon`, `actions` | Admin page title (h1). |
| `Avatar` / `AvatarGroup` | `name`, `image` (ImageOut → `thumb_url`), `size` xs·sm·md·lg·xl·px, `decorative`, `ring` / `people`, `max` | Initials on a deterministic warm colour when there is no photo. |
| `CategoryBadge` / `CategoryBadgeGroup` | `category`, `size` (26), `decorative`, `ring` / `categories`, `max` (3) | White icon on `ensureContrast(adapt(color))` (palette-adapted); group shows "+N". |
| `CategoryPill` | `category`, `size` sm·md·lg, `expanded?` | Circle → pill (icon + name) on hover / keyboard focus / tap (tap again or outside to close); colour adapted to the palette, then `ensureContrast`, white text, no border; accessible name = category name. |
| `TextField` / `TextAreaField` | `label`, `value`, `onChange`, `description`, `errorMessage`, `isRequired`, `type`, `icon`, `size` / `rows`, `maxLength`, `showCount` | `errorMessage` marks the field invalid. |
| `PasswordField` | `label`, `value`, `onChange`, **`autoComplete`** current-password·new-password, `description`, `errorMessage`, `isRevealed` + `onRevealChange` | Lock icon and an eye button that shows/hides the text (uncontrolled unless `isRevealed` is given). |
| `DateField` | `label`, `value: 'YYYY-MM-DD' \| null`, `onChange`, `minValue`, `maxValue`, `isRequired`, `errorMessage` | Locale segment order, calendar popover with "Hoy" / "Borrar fecha". |
| `Select` | `label`/`aria-label`, `options: {value, label, icon?, description?}[]`, `value`, `onChange`, `placeholder` | Single choice. |
| `SegmentedControl` | `aria-label`, `options: {value, label, icon?, aria-label?}[]`, `value`, `onChange`, `size`, `fullWidth` | Radio semantics, sliding indicator. |
| `ChipMultiSelect` | `label`, `options: {id, label, color?, icon?, image?}[]`, `value`, `onChange`, **`ordered`** | Unordered: toggle chips. Ordered: ranked list (1 = "Principal") with move up/down/remove + "add" chips; keeps selection order. `icon` → category badge, `image` (or `null`) → avatar, `color` → dot. |
| `ColorInput` | `label`, `value` (hex), `onChange(hex)`, `presets`, `description`, `errorMessage` | Swatch → popover (area, hue, presets) + editable hex field. |
| `IconPicker` | `label`, `value`, `onChange(key)`, `color` | Searchable grid over `CATEGORY_ICONS` (ES/EN keywords, accent-insensitive). |
| `Switch` / `Slider` | react-aria props + children label / `label`, `showValue`, `formatOptions` | e.g. `formatOptions={{ style: 'percent' }}` for opacity. |
| `Menu`, `MenuItem`, `MenuSection`, `MenuSeparator`, `MenuTrigger` | `MenuItem`: `icon`, `description`, `tone` danger | `<MenuTrigger><IconButton …/><Menu onAction={…}>…</Menu></MenuTrigger>`; selectable menus show a check. |
| `Tooltip` | react-aria Tooltip props | Use inside `TooltipTrigger` (IconButton already does). |
| Field helpers | `FieldLabel`, `FieldDescription`, `FieldErrorMessage`, `Static*` | For custom fields that should look like the rest. |

Icons (`src/icons`): `CATEGORY_ICONS`, `CATEGORY_ICON_KEYS`, `categoryIcon(key)`, `searchCategoryIcons(query)`,
`<CategoryIcon icon size stroke />` (decorative unless given `aria-label`), `GoogleMark`.

## App contracts used with the components

`useI18n()` (`t`, `lang`, `setLang`, `formatDate(value, style)`, `formatNumber`, `hasMessage`, `locale`),
`useErrorMessage()` / `useFieldErrors()` (translate `ApiError`s), `useToast().show({ tone, message, action? })`
(`action: { label, to? | onPress? }`), `useAuth()`, `useTheme()` (`preference`, `resolved`, `palette`,
`setPreference`, `setPalette`), `useThemeColors()`, `useCurrentChild()`, `useIsMobile()`,
`useDocumentTitle(...parts)`.

## Testing

`src/utils/test-utils.tsx`: `mockApi({ 'GET /api/x': body | reply(status, body) | (request) => … })`,
`mockSignedIn(session?, extra?)`, `renderWithProviders(ui, { route, path })`, `renderApp(route)`,
`createTestQueryClient()`, fixtures (`ADMIN_SESSION`, `VIEWER_SESSION`, `ANONYMOUS_SESSION`, `TEST_CHILDREN`,
`TEST_CATEGORIES`). Motion animations are instant in tests. CSS Module classes keep their names (`fullScreen`).
