import type { Messages } from '../../types'
import type { push as source } from '../es/push'

export const push: Messages<typeof source> = {
  title: 'Notifications on this device',
  switch: 'Notify me of memories',
  description: 'A notification at 9:00 on days with memories, on this device.',
  enabled: 'All set: we’ll notify you at 9:00 on days with memories.',
  test: 'Send a test notification',
  tested: 'Notification sent: it will arrive in a few seconds.',
  error: 'Notifications could not be turned on on this device.',
  install:
    'To get notifications on an iPhone or iPad, add Timelife to the Home Screen (Share → Add to Home Screen) and open it from there.',
  denied: 'Timelife’s notifications are blocked on this device: allow them in the browser or system settings.',
  invite: {
    message: 'Shall we notify you on days with memories? They arrive at 9:00.',
    action: 'Turn on',
  },
}
