import type { Messages } from '../../types'
import type { memories as source } from '../es/memories'

export const memories: Messages<typeof source> = {
  button: {
    label: 'Memories',
    unseen: { one: 'Memories ({count} new today)', other: 'Memories ({count} new today)' },
  },
  title: 'Today’s memories',
  loading: 'Looking for memories…',
  error: 'Memories could not be loaded.',
  ago: {
    months: { one: '{count} month ago', other: '{count} months ago' },
    years: { one: '{count} year ago', other: '{count} years ago' },
  },
  empty: 'No memories today.',
  next: { one: 'The next one, on {date}:', other: 'The next ones, on {date}:' },
  nextMore: 'And {count} more that day.',
  none: 'When milestones turn months or years old, you’ll see them here.',
  toast: {
    single: 'On this day, {ago}: “{title}”.',
    several: {
      one: 'On this day, {ago}: “{title}” and {count} more memory.',
      other: 'On this day, {ago}: “{title}” and {count} more memories.',
    },
    action: 'See',
  },
}
