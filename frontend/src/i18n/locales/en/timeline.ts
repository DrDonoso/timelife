import type { Messages } from '../../types'
import type { timeline as source } from '../es/timeline'

// Namespace owned by frontend-timeline (mirrors ../es/timeline.ts).
export const timeline: Messages<typeof source> = {
  regionLabel: "{name}'s timeline",
  family: {
    name: 'All together',
    regionLabel: 'Everyone’s timeline',
    empty: 'No milestones yet',
  },
  listLabel: {
    years: { one: 'Years with milestones: {count} year', other: 'Years with milestones: {count} years' },
    months: { one: 'Months with milestones: {count} month', other: 'Months with milestones: {count} months' },
    events: { one: '{count} milestone', other: '{count} milestones' },
  },
  levels: {
    years: 'Years',
    months: 'Months',
    events: 'Days',
  },
  levelView: {
    years: 'Years view',
    months: 'Months view',
    events: 'Days view',
  },
  zoom: {
    group: 'Timeline zoom',
    level: 'Level of detail',
    in: 'Zoom in',
    out: 'Zoom out',
    inShortcut: 'Zoom in (+)',
    outShortcut: 'Zoom out (−)',
  },
  count: { zero: 'No milestones', one: '{count} milestone', other: '{count} milestones' },
  hubLabel: { one: '{period} · {count} milestone', other: '{period} · {count} milestones' },
  eventLabel: '{title} · {date}',
  eventLabelWithCategories: '{title} · {date} · {categories}',
  eventLabelPeople: '{label} · {people}',
  announce: {
    one: '{level} · {count} item',
    other: '{level} · {count} items',
  },
  hint: 'Ctrl + wheel or pinch to zoom',
  loading: 'Loading the timeline…',
  empty: {
    title: 'No milestones for {name} yet',
    descriptionAdmin: 'Add the first one and start building the timeline.',
    descriptionViewer: 'Milestones will show up here as soon as they are added.',
    action: 'Add the first milestone',
  },
  noResults: {
    title: 'No milestones match your search',
    description: 'Try other words, dates or categories.',
    action: 'Clear filters',
  },
  error: {
    title: "The timeline couldn't be loaded",
    retry: 'Try again',
  },
  create: {
    action: 'New milestone',
    title: 'New milestone',
  },
}
