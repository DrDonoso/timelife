import type { Messages } from '../../types'
import type { demo as source } from '../es/demo'

export const demo: Messages<typeof source> = {
  welcome:
    'Welcome to the Timelife demo: a made-up family with sample data. Try anything you like; your changes stay in this tab and a reload brings back the original data.',
  reset: 'Reset the demo',
}
