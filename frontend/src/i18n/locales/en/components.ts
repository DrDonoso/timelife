import type { Messages } from '../../types'
import type { components as source } from '../es/components'

export const components: Messages<typeof source> = {
  modal: {
    close: 'Close',
  },
  spinner: {
    label: 'Loading',
  },
  toast: {
    dismiss: 'Dismiss notification',
  },
  select: {
    placeholder: 'Select an option',
  },
  textArea: {
    counter: '{count} / {max}',
  },
  passwordField: {
    show: 'Show password',
    hide: 'Hide password',
  },
  colorInput: {
    open: 'Choose colour',
    hex: 'Colour code',
    hue: 'Hue',
    area: 'Saturation and brightness',
    presets: 'Suggested colours',
    invalid: 'Enter a hex colour, for example #3b82f6.',
  },
  iconPicker: {
    search: 'Search icons',
    results: { zero: 'No icons', one: '{count} icon', other: '{count} icons' },
    noResults: 'No icon matches “{query}”.',
  },
  dateField: {
    openCalendar: 'Open calendar',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    today: 'Today',
    clear: 'Clear date',
  },
  chipMultiSelect: {
    selected: 'Selected',
    available: 'Available',
    noneSelected: 'Nothing selected yet.',
    primary: 'Primary',
    orderHint: 'Order matters: the first one is the primary.',
    moveEarlier: 'Move {label} earlier',
    moveLater: 'Move {label} later',
    remove: 'Remove {label}',
    add: 'Add {label}',
  },
  categoryBadges: {
    more: { one: '{count} more category', other: '{count} more categories' },
  },
  avatarGroup: {
    more: { one: '{count} more', other: '{count} more' },
  },
}
