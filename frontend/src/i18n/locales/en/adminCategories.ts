import type { Messages } from '../../types'
import type { adminCategories as source } from '../es/adminCategories'

// Namespace owned by frontend-admin-settings (Admin → Categories).
export const adminCategories: Messages<typeof source> = {
  description:
    'They group milestones by type. Their colour and icon show on the timeline, and their order is the one used by filters and pickers.',
  new: 'New category',
  listLabel: 'Categories (drag to reorder)',
  count: { one: '{count} category', other: '{count} categories' },
  loadError: 'The categories could not be loaded.',
  empty: {
    title: 'No categories yet',
    description: 'Create the first one to sort milestones, for example “First words” or “Sleep”.',
  },
  reorder: {
    hint: 'Drag the rows or use the arrows to change the order. It is saved automatically.',
    saving: 'Saving the order…',
    saved: 'Order saved',
    moved: '{name}: position {position} of {total}.',
  },
  row: {
    drag: 'Drag {name} to reorder',
    moveUp: 'Move {name} up',
    moveDown: 'Move {name} down',
    edit: 'Edit {name}',
    delete: 'Delete {name}',
    color: 'Colour',
    icon: 'Icon',
  },
  form: {
    createTitle: 'New category',
    editTitle: 'Edit category',
    nameEs: 'Name in Spanish',
    nameEn: 'Name in English',
    namePt: 'Name in Portuguese',
    nameEsPlaceholder: 'Por ejemplo, Primeras palabras',
    nameEnPlaceholder: 'For example, First words',
    namePtPlaceholder: 'Por exemplo, Primeiras palavras',
    nameEsRequired: 'Enter the Spanish name.',
    nameEnRequired: 'Enter the English name.',
    namePtRequired: 'Enter the Portuguese name.',
    tooLong: 'At most {max} characters.',
    color: 'Colour',
    colorDescription: 'Pick a suggested colour or any other.',
    colorInvalid: 'Enter a hex colour, for example #3b82f6.',
    icon: 'Icon',
    iconRequired: 'Choose an icon.',
    create: 'Create category',
    save: 'Save changes',
  },
  preview: {
    title: 'Preview',
    light: 'Light mode',
    dark: 'Dark mode',
    sampleTitle: 'First milestone',
    placeholderName: 'New category',
    contrastNote: 'So that white text stays readable, pills and badges use a slightly deeper shade of this colour.',
  },
  delete: {
    title: 'Delete “{name}”?',
    message: 'It can only be deleted when no milestone uses it, including those in the trash. This cannot be undone.',
    confirm: 'Delete category',
  },
  toast: {
    created: 'Category “{name}” created.',
    updated: 'Category “{name}” saved.',
    deleted: 'Category “{name}” deleted.',
  },
}
