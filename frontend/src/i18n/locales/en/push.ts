import type { Messages } from '../../types'
import type { push as source } from '../es/push'

export const push: Messages<typeof source> = {
  title: 'Notifications on this device',
  switch: 'Turn on notifications',
  enabled: 'All set: notifications are on for this device.',
  error: 'Notifications could not be turned on on this device.',
  install:
    'To get notifications on an iPhone or iPad, add Timelife to the Home Screen (Share → Add to Home Screen) and open it from there.',
  denied: 'Timelife’s notifications are blocked on this device: allow them in the browser or system settings.',
  invite: {
    message: 'Shall we turn on notifications? We’ll tell you about each day’s memories and new milestones.',
    action: 'Turn on',
  },
  choose: 'Choose notifications',
  choices: {
    intro: 'Choose the ones you want. They apply to all your devices with notifications turned on.',
    memories: { label: 'Today’s memories', description: 'At 9:00, on days with memories.' },
    milestones: { label: 'New milestones', description: 'When someone else adds a milestone.' },
    error: 'Your notifications could not be loaded.',
    done: 'Done',
  },
}
