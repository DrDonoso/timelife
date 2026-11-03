import type { Messages } from '../../types'
import type { adminBackup as source } from '../es/adminBackup'

export const adminBackup: Messages<typeof source> = {
  description: 'Download a full copy of Timelife or restore a copy on this server.',
  size: '≈ {size}',
  summary: {
    events: { zero: 'No milestones', one: '{count} milestone', other: '{count} milestones' },
    trashed: { one: '{count} in the trash', other: '{count} in the trash' },
    photos: { zero: 'No photos', one: '{count} photo', other: '{count} photos' },
    livePhotos: { one: '{count} Live', other: '{count} Live' },
    videos: { zero: 'No videos', one: '{count} video', other: '{count} videos' },
    children: { zero: 'No children', one: '{count} child', other: '{count} children' },
    categories: { zero: 'No categories', one: '{count} category', other: '{count} categories' },
    users: { one: '{count} user', other: '{count} users' },
    admins: { one: '{count} administrator', other: '{count} administrators' },
    yearColors: { one: '{count} year colour', other: '{count} year colours' },
    background: 'Background image',
  },
  export: {
    title: 'Export',
    description:
      'One ZIP file with everything: the milestones (those in the trash too) with their original photos and videos, the children, the categories, the users and the appearance. Open it and you will find the photos sorted by year and milestone.',
    contents: 'What the copy holds',
    action: 'Download a copy',
    note: 'The download starts right away and may take a while with many videos. Sessions are not copied: everyone signs in again with their Google account.',
    loadError: 'Could not work out what the copy holds.',
  },
  import: {
    title: 'Import',
    description:
      'Restore a Timelife copy (the ZIP file you download above), from another server too. The file is uploaded in parts: if the connection drops, choose it again and it goes on where it stopped.',
    choose: 'Choose a ZIP file',
    loadError: 'Could not check the import.',
    uploading: 'Uploading “{name}”',
    uploaded: '{sent} of {size}',
    cancelUpload: 'Cancel upload',
    resume: {
      title: 'Upload left half-way',
      description: '“{name}” was left half-way ({received} of {size}). Choose the same file to go on where it stopped.',
      action: 'Continue with the same file',
    },
    otherFile: 'That is not the file that was being uploaded. Choose “{name}” or discard the upload.',
    discard: 'Discard',
    invalid: '“{name}” cannot be imported',
    archive: {
      title: 'Copy of {date}',
      version: 'Made with Timelife {version}',
      contents: 'What the file holds',
      missing: {
        one: '{count} photo or video file is missing from the copy: it will not be imported.',
        other: '{count} photo or video files are missing from the copy: they will not be imported.',
      },
    },
    previousError: 'The last import did not finish: {reason} Nothing was changed; you can try again.',
    mode: {
      label: 'How do you want to import it?',
      merge: {
        title: 'Merge',
        description:
          'Adds what is missing and never changes or deletes anything already here. A milestone already exists when its date, title and children match, even in the trash.',
      },
      replace: {
        title: 'Replace everything',
        description:
          'Deletes everything here now (milestones, photos and videos, children, categories, users and appearance) and leaves the copy as it was, with the same links. You stay an administrator.',
      },
    },
    start: 'Import',
    confirm: {
      title: 'Replace everything?',
      message:
        'Everything in Timelife now will be deleted and replaced by the copy of {date}. This cannot be undone: if in doubt, download a copy first.',
      action: 'Replace everything',
    },
    running: {
      media: 'Processing photos and videos…',
      saving: 'Saving the changes…',
      progress: '{done} of {total}',
      note: 'You can leave this page: the import carries on on the server.',
    },
    cancel: 'Cancel import',
  },
  report: {
    title: 'Import finished',
    mode: {
      merge: 'The copy was merged with what was already here.',
      replace: 'Everything was replaced by the copy.',
    },
    caption: 'Import result',
    columns: { item: 'Item', created: 'New', skipped: 'Already here', failed: 'Failed' },
    rows: {
      events: 'Milestones',
      media: 'Photos, videos, avatars and background',
      children: 'Children',
      categories: 'Categories',
      users: 'Users',
      year_colors: 'Year colours',
    },
    issues: 'Items with problems',
    issue: '{kind} “{name}”: {reason}',
    kinds: {
      user: 'User',
      category: 'Category',
      child: 'Child',
      event: 'Milestone',
      media: 'Photo or video',
      year_color: 'Year colour',
      settings: 'Settings',
    },
    more: { one: 'And {count} more.', other: 'And {count} more.' },
    videos: 'The videos are being converted in the background: they show “Processing…” for a while.',
    close: 'Close',
  },
}
