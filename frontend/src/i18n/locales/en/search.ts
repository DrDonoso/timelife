import type { Messages } from '../../types'
import type { search as source } from '../es/search'

export const search: Messages<typeof source> = {
  bar: {
    label: 'Search milestones',
    placeholder: 'Search milestones…',
    clear: 'Clear search',
    shortcut: 'Press / to search',
    results: 'Matching milestones',
    searching: 'Searching…',
    noResults: 'No milestone matches “{query}”.',
    noResultsFiltered: 'Date and category filters apply too.',
    error: 'The search failed. Please try again.',
    more: 'Showing {shown} of {count}. Press Enter to see them all on the timeline.',
  },
  toggle: {
    label: 'Filters',
    active: { one: 'Filters ({count} active)', other: 'Filters ({count} active)' },
  },
  panel: {
    title: 'Filters',
    close: 'Close filters',
    searchTitle: 'Search',
    removeSearch: 'Remove the search “{query}”',
    datesTitle: 'Dates',
    from: 'From',
    to: 'To',
    rangeError: 'Must be on or after “From”.',
    yearRange: 'Choose a year between {min} and {max}.',
    presets: {
      label: 'Quick ranges',
      thisYear: 'This year',
      last12Months: 'Last 12 months',
      lastYear: 'Last year',
    },
    categoriesTitle: 'Categories',
    categoriesEmpty: 'There are no categories yet.',
    categoriesError: 'Categories could not be loaded.',
    count: { one: '{shown} of {count} milestone', other: '{shown} of {count} milestones' },
    counting: 'Counting milestones…',
    countError: 'Milestones could not be counted.',
    clear: 'Clear filters',
    showResults: { zero: 'No milestones', one: 'Show {count} milestone', other: 'Show {count} milestones' },
  },
}
