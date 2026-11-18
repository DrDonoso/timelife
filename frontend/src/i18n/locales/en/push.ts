import type { Messages } from '../../types'
import type { push as source } from '../es/push'

export const push: Messages<typeof source> = {
  title: 'Notifications on this device',
  switch: 'Turn on notifications',
  description: 'You’ll get each day’s memories on this device, at 9:00.',
  enabled: 'All set: notifications are on for this device.',
  test: 'Send a test notification',
  tested: 'Notification sent: it will arrive in a few seconds.',
  error: 'Notifications could not be turned on on this device.',
  install:
    'To get notifications on an iPhone or iPad, add Timelife to the Home Screen (Share → Add to Home Screen) and open it from there.',
  denied: 'Timelife’s notifications are blocked on this device: allow them in the browser or system settings.',
  invite: {
    message: 'Shall we turn on notifications? We’ll tell you about each day’s memories.',
    action: 'Turn on',
  },
}
