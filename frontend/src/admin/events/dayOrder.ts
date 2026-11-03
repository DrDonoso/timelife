/** Consecutive items of the same date (the admin list is sorted by date), in list order. */
export function groupByDay<T extends { date: string }>(items: readonly T[]): T[][] {
  const groups: T[][] = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last && last[0].date === item.date) last.push(item)
    else groups.push([item])
  }
  return groups
}

/**
 * `items` with the events of `date` listed in `ids` placed, in that order, in the positions those
 * events already take — what `PUT /api/admin/events/day-order` does on the server.
 */
export function applyDayOrder<T extends { id: number; date: string }>(items: readonly T[], date: string, ids: readonly number[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const moving = ids.flatMap((id) => {
    const item = byId.get(id)
    return item && item.date === date ? [item] : []
  })
  const listed = new Set(moving.map((item) => item.id))
  let next = 0
  return items.map((item) => (listed.has(item.id) ? (moving[next++] ?? item) : item))
}
