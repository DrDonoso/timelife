import type { Messages } from '../../types'
import type { detail as source } from '../es/detail'

// Event detail card (owned by frontend-detail).
export const detail: Messages<typeof source> = {
  dialogLabel: 'Milestone details',
  loading: 'Loading the milestone…',
  close: 'Close',
  edit: 'Edit milestone',
  editing: 'Editing “{title}”',
  saved: 'Changes saved',
  date: 'Date',
  location: 'Place',
  categories: 'Categories',
  children: 'Children in this milestone',
  notFound: {
    title: 'We couldn’t find this milestone',
    description: 'It may have been deleted, or the link is no longer valid.',
    action: 'Back to the timeline',
  },
  loadError: {
    title: 'The milestone couldn’t be loaded',
  },
  leaveEditor: {
    title: 'Leave without saving?',
    message: 'If you leave now, any unsaved changes will be lost.',
    confirm: 'Leave without saving',
    stay: 'Keep editing',
  },
  editorError: {
    title: 'The editor couldn’t be opened',
    description: 'Check your connection and try again.',
    back: 'Back to the milestone',
  },
  carousel: {
    label: 'Photos of “{title}”',
    mediaLabel: 'Photos and videos of “{title}”',
    roleDescription: 'carousel',
    slideRoleDescription: 'photo',
    videoRoleDescription: 'video',
    slideLabel: '{current} of {total}',
    previous: 'Previous photo',
    next: 'Next photo',
    pagination: 'Choose a photo',
    goTo: 'Show photo {current} of {total}',
    status: 'Photo {current} of {total}: {name}',
    imageError: 'This photo couldn’t be loaded',
    videoProcessing: 'Preparing the video…',
    videoFailed: 'This video can’t be played',
    playLive: 'Play the Live Photo “{name}”',
    liveTag: 'LIVE',
  },
  viewer: {
    open: 'View the photo full screen',
    label: 'Photos of “{title}”, full screen',
    mediaLabel: 'Photos and videos of “{title}”, full screen',
    close: 'Exit full screen',
  },
}