import type { Messages } from '../../types'
import type { shell as source } from '../es/shell'

export const shell: Messages<typeof source> = {
  skipToContent: 'Skip to content',
  home: 'Timelife, home',
  childSwitcher: {
    label: 'Switch child',
    current: 'Viewing {name}',
    all: 'All together',
    allDescription: 'Each child on their own line',
  },
  search: {
    open: 'Search',
    close: 'Close search',
  },
  themeMenu: 'Theme: {palette} · Mode: {mode}',
  languageMenu: 'Language: {language}',
  userMenu: {
    label: 'User menu',
    admin: 'Administration',
    timeline: 'Timeline',
    signOut: 'Sign out',
  },
  notifications: 'Notifications',
  noChildren: {
    title: 'No children yet',
    descriptionAdmin: 'Add the first child to start saving their milestones.',
    descriptionViewer: 'Once an administrator adds the children, their milestones will appear here.',
    action: 'Add children',
  },
  childNotFound: {
    title: 'We could not find this child',
    description: 'The link may have changed or the child no longer exists.',
    action: 'Go to the timeline',
  },
  childrenError: 'Could not load the children.',
}
