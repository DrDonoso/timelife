import type { Messages } from '../../types'
import type { whatsNew as source } from '../es/whatsNew'

export const whatsNew: Messages<typeof source> = {
  title: "What's new",
  intro: "Here's what's new in Timelife since you last came in.",
  allIntro: 'Everything that has come to Timelife, newest first.',
  empty: 'Nothing new yet.',
  gotIt: 'Got it!',
  showMore: { one: 'Show {count} more', other: 'Show {count} more' },
  goThere: 'Take me there',
  adminsOnly: 'Administrators only',
  kinds: {
    new: 'New',
    improved: 'Improved',
    fixed: 'Fixed',
  },
}
