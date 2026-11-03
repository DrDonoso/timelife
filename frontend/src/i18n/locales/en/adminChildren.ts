import type { Messages } from '../../types'
import type { adminChildren as source } from '../es/adminChildren'

// Namespace owned by frontend-admin-settings (Admin → Children).
export const adminChildren: Messages<typeof source> = {
  description: 'Each child has their own timeline. A milestone can belong to several children.',
  new: 'Add child',
  listLabel: 'Children (drag to reorder)',
  count: { one: '{count} child', other: '{count} children' },
  loadError: 'The children could not be loaded.',
  empty: {
    title: 'No children yet',
    description: 'Add the first one to start saving their milestones.',
  },
  reorder: {
    hint: 'Drag the cards or use the arrows to change the order of the child switcher.',
    saving: 'Saving the order…',
    saved: 'Order saved',
    moved: '{name}: position {position} of {total}.',
  },
  card: {
    born: 'Born {date}',
    noBirthDate: 'No birth date',
    ageMonths: { zero: 'under 1 month', one: '{count} month', other: '{count} months' },
    ageYears: { one: '{count} year', other: '{count} years' },
    drag: 'Drag {name} to reorder',
    moveEarlier: 'Move {name} earlier',
    moveLater: 'Move {name} later',
    edit: 'Edit {name}',
    delete: 'Delete {name}',
  },
  form: {
    createTitle: 'Add child',
    editTitle: 'Edit {name}',
    name: 'Name',
    namePlaceholder: 'For example, Lucía',
    nameRequired: 'Enter the name.',
    tooLong: 'At most {max} characters.',
    birthDate: 'Date of birth',
    birthDateHelp: 'Optional.',
    birthDateInvalid: 'The date is not valid.',
    waitUpload: 'Wait until the photo finishes uploading.',
    create: 'Add child',
    save: 'Save changes',
  },
  avatar: {
    label: 'Photo',
    upload: 'Upload photo',
    change: 'Change photo',
    remove: 'Remove photo',
    restore: 'Restore photo',
    hint: 'JPEG, PNG, WebP or HEIC. Shown cropped to a circle.',
    removed: 'The photo will be deleted when you save.',
    gone: 'This photo is no longer available. Upload it again.',
  },
  upload: {
    uploading: 'Uploading {name}…',
    cancel: 'Cancel upload',
    dismiss: 'Dismiss',
    failed: 'The image could not be uploaded. {error}',
  },
  delete: {
    title: 'Delete {name}?',
    message:
      'Their photo will be deleted too. A child can only be deleted when they have no milestones, including those in the trash. This cannot be undone.',
    confirm: 'Delete',
  },
  toast: {
    created: '{name} has been added.',
    updated: '{name}’s changes saved.',
    deleted: '{name} has been deleted.',
  },
}
