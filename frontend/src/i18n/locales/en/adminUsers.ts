import type { Messages } from '../../types'
import type { adminUsers as source } from '../es/adminUsers'

// Namespace owned by frontend-admin-settings (Admin → Users).
export const adminUsers: Messages<typeof source> = {
  description: 'Who can sign in to Timelife and with which permissions.',
  count: { one: '{count} person', other: '{count} people' },
  loadError: 'The users could not be loaded.',
  invite: {
    title: 'Give someone access',
    explanation:
      'Timelife is private: only the people you add here can sign in. Give them a temporary password and tell them, with their e-mail: they’ll change it the first time they sign in.',
    explanationGoogle:
      'Timelife is private: only the people you add here can sign in. They’ll use “Continue with Google” with this e-mail or, if you give them a temporary password, their e-mail and that password (they’ll change it when signing in).',
    email: 'E-mail',
    emailPlaceholder: 'name@example.com',
    name: 'Name',
    nameDescription: 'Optional.',
    role: 'Role',
    password: 'Temporary password',
    passwordDescription: 'At least 8 characters. They’ll change it the first time they sign in.',
    passwordDescriptionGoogle: 'Optional: without it they can only sign in with Google. They’ll change it the first time they sign in.',
    generate: 'Generate',
    generateLabel: 'Generate a temporary password',
    submit: 'Add',
    required: 'Enter the person’s e-mail.',
    invalidEmail: 'Enter a valid e-mail, for example name@example.com.',
    exists: 'This e-mail already has access.',
    success: 'Done: {email} can now sign in with their e-mail and the temporary password.',
    successGoogle: 'Done: {email} can now sign in with Google.',
  },
  roles: {
    viewer: 'Sees the timelines and the photos',
    admin: 'Also adds and edits milestones, photos, children, appearance and users',
  },
  notes: {
    roles: 'Viewers only see the timelines and the photos; administrators can also change everything and upload photos and videos.',
    sessions: 'Changing someone’s role, disabling them or resetting their password signs them out on all their devices.',
  },
  table: {
    caption: 'Users with access to Timelife',
    user: 'Person',
    role: 'Role',
    enabled: 'Enabled',
    access: 'Access',
    lastLogin: 'Last sign-in',
    actions: 'Actions',
  },
  you: 'You',
  disabledBadge: 'Disabled',
  password: {
    set: 'Password',
    setHint: 'Signs in with their e-mail and password.',
    temporary: 'Temporary password',
    temporaryHint: 'They must change it the next time they sign in.',
    none: 'No password',
    noneHint: 'They can’t sign in until you give them a password.',
    noneHintGoogle: 'Signs in with Google only.',
  },
  google: {
    linked: 'Google',
    linkedHint: 'Has signed in with Google.',
    pending: 'Google pending',
    pendingHint: 'Has not signed in with Google yet.',
  },
  never: 'Never',
  roleLabel: 'Role of {email}',
  enabledLabel: 'Access enabled for {email}',
  delete: 'Delete {email}',
  resetPassword: 'Reset the password of {email}',
  setPassword: 'Give {email} a password',
  lock: {
    self: 'You can’t change your own role, disable or delete yourself. Change your password from your menu.',
  },
  confirmDelete: {
    title: 'Delete {email}?',
    message: 'They will lose access right away and be signed out. You can give them access again at any time.',
    confirm: 'Remove access',
  },
  passwordDialog: {
    title: 'Temporary password for {email}',
    description:
      'Type or generate a temporary password and tell them: they’ll have to change it the first time they sign in. They’ll be signed out on all their devices.',
    submit: 'Save password',
  },
  toast: {
    role: 'Role of {email} changed to {role}.',
    enabled: '{email} has access again.',
    disabled: '{email} can no longer sign in.',
    deleted: '{email} no longer has access.',
    password: 'Temporary password of {email} saved: they’ll change it when signing in.',
  },
}
