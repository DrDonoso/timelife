// Spanish source dictionary (default language). Every namespace lives in its own file, owned by
// the feature that uses it; English mirrors these shapes (see ../en/index.ts).
import { admin } from './admin'
import { adminAppearance } from './adminAppearance'
import { adminBackup } from './adminBackup'
import { adminCategories } from './adminCategories'
import { adminChildren } from './adminChildren'
import { adminEvents } from './adminEvents'
import { adminTrash } from './adminTrash'
import { adminUsers } from './adminUsers'
import { auth } from './auth'
import { common } from './common'
import { components } from './components'
import { demo } from './demo'
import { detail } from './detail'
import { errors } from './errors'
import { search } from './search'
import { shell } from './shell'
import { timeline } from './timeline'

export const es = {
  common,
  errors,
  auth,
  shell,
  admin,
  components,
  timeline,
  search,
  detail,
  adminEvents,
  adminTrash,
  adminCategories,
  adminChildren,
  adminAppearance,
  adminUsers,
  adminBackup,
  demo,
}
