import type { Messages } from '../../types'
import type { admin as source } from '../es/admin'

export const admin: Messages<typeof source> = {
  title: 'Administration',
  nav: {
    label: 'Sections',
    events: 'Events',
    categories: 'Categories',
    children: 'Children',
    appearance: 'Colours & appearance',
    users: 'Users',
    trash: 'Trash',
    backup: 'Import & export',
  },
  backToTimeline: 'Back to the timeline',
  openMenu: 'Open the administration menu',
  closeMenu: 'Close menu',
  version: 'Version {version}',
  versionWithDate: 'Version {version} · {date}',
  discardChanges: {
    title: 'Discard your changes?',
    message: 'You have unsaved changes. If you close now, they will be lost.',
    confirm: 'Discard changes',
    stay: 'Keep editing',
  },
  notFound: {
    title: 'Section not found',
    description: 'This administration page does not exist.',
    action: 'Go to events',
  },
}
