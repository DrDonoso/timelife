import type { Messages } from '../../types'
import type { adminTrash as source } from '../es/adminTrash'

// Namespace owned by frontend-admin-events (mirrors ../es/adminTrash.ts).
export const adminTrash: Messages<typeof source> = {
  description: 'Deleted events stay here until you restore them or delete them forever.',
  listLabel: 'Events in the trash',
  count: { one: '{count} event in the trash', other: '{count} events in the trash' },
  deletedAt: 'Deleted on {date}',
  deletedBy: 'Deleted on {date} by {name}',
  restore: 'Restore',
  restoreLabel: 'Restore “{title}”',
  restored: '“{title}” was restored.',
  edit: 'Edit',
  purge: 'Delete permanently',
  purgeLabel: 'Delete permanently “{title}”',
  purgeTitle: 'Delete forever?',
  purgeMessage: {
    zero: '“{title}” will be deleted permanently. This cannot be undone.',
    one: '“{title}” and its photo will be deleted permanently. This cannot be undone.',
    other: '“{title}” and its {count} photos will be deleted permanently. This cannot be undone.',
  },
  /** `purgeMessage` of an event with videos (`count`: photos and videos). */
  purgeMediaMessage: {
    one: '“{title}” and its video will be deleted permanently. This cannot be undone.',
    other: '“{title}” and its {count} photos and videos will be deleted permanently. This cannot be undone.',
  },
  purgeConfirm: 'Delete forever',
  purged: '“{title}” was deleted permanently.',
  empty: {
    title: 'The trash is empty',
    description: 'When you delete an event it will appear here and you can restore it.',
    action: 'Go to events',
  },
  loadError: 'The trash could not be loaded.',
}
