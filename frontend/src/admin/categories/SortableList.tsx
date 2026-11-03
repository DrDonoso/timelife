import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconGripVertical,
} from '@tabler/icons-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button as AriaButton, DropIndicator, GridList, GridListItem, useDragAndDrop } from 'react-aria-components'
import { IconButton } from '../../components/IconButton'
import { Spinner } from '../../components/Spinner'
import { cx } from '../../components/utils'
import styles from './SortableList.module.css'
import type { OrderStatus } from './useOrderSaver'

/** What each rendered item receives to build its reorder controls. */
export interface SortableControls {
  index: number
  total: number
  /** Moves the item one place earlier (-1) or later (+1). */
  move: (delta: -1 | 1) => void
  isDisabled: boolean
}

export interface SortableListProps<T extends { id: number }> {
  'aria-label': string
  items: readonly T[]
  /** `stack`: one row per item; `grid`: wrapping cards. */
  layout?: 'stack' | 'grid'
  /** Plain-text name of an item (typeahead, drag data, row label). */
  textValue: (item: T) => string
  /** Receives every id in the new order. */
  onReorder: (ids: number[]) => void
  /** Polite announcement after a move, e.g. "Sueño: position 2 of 11". */
  describeMove?: (item: T, position: number, total: number) => string
  /** Row action (click / Enter on the item itself). */
  onAction?: (item: T) => void
  isDisabled?: boolean
  className?: string
  itemClassName?: string
  children: (item: T, controls: SortableControls) => ReactNode
}

/** `ids` with `id` moved to `toIndex` (clamped). */
export function moveId(ids: readonly number[], id: number, toIndex: number): number[] {
  const rest = ids.filter((item) => item !== id)
  const index = Math.min(Math.max(toIndex, 0), rest.length)
  return [...rest.slice(0, index), id, ...rest.slice(index)]
}

/**
 * Reorderable collection: pointer/touch drag and drop plus keyboard drag (react-aria GridList
 * with a drag handle), and explicit "move earlier/later" buttons rendered with {@link MoveButtons}.
 */
export function SortableList<T extends { id: number }>({
  'aria-label': ariaLabel,
  items,
  layout = 'stack',
  textValue,
  onReorder,
  describeMove,
  onAction,
  isDisabled = false,
  className,
  itemClassName,
  children,
}: SortableListProps<T>) {
  const [announcement, setAnnouncement] = useState('')
  const ids = items.map((item) => item.id)

  function commit(next: number[], movedId: number) {
    if (next.every((value, index) => value === ids[index])) return
    const item = items.find((candidate) => candidate.id === movedId)
    if (item && describeMove) setAnnouncement(describeMove(item, next.indexOf(movedId) + 1, next.length))
    onReorder(next)
  }

  const { dragAndDropHooks } = useDragAndDrop<T>({
    isDisabled,
    getItems: (keys) =>
      [...keys].map((key) => {
        const item = items.find((candidate) => String(candidate.id) === String(key))
        return { 'text/plain': item ? textValue(item) : String(key) }
      }),
    onReorder(event) {
      const moving = ids.filter((id) => [...event.keys].some((key) => String(key) === String(id)))
      if (moving.length === 0) return
      const rest = ids.filter((id) => !moving.includes(id))
      const targetIndex = rest.findIndex((id) => String(id) === String(event.target.key))
      if (targetIndex === -1) return
      const insertAt = event.target.dropPosition === 'after' ? targetIndex + 1 : targetIndex
      commit([...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)], moving[0])
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className={styles.dropIndicator} />,
  })

  return (
    <div className={cx(styles.root, className)}>
      <GridList
        aria-label={ariaLabel}
        layout={layout}
        // Tab walks through each item's buttons; arrow keys move between items.
        keyboardNavigationBehavior="tab"
        dragAndDropHooks={dragAndDropHooks}
        onAction={
          onAction
            ? (key) => {
                const item = items.find((candidate) => String(candidate.id) === String(key))
                if (item) onAction(item)
              }
            : undefined
        }
        className={cx(styles.list, layout === 'grid' ? styles.grid : styles.stack)}
      >
        {items.map((item, index) => (
          <GridListItem key={item.id} id={item.id} textValue={textValue(item)} className={cx(styles.item, itemClassName)}>
            {children(item, {
              index,
              total: items.length,
              isDisabled,
              move: (delta) => commit(moveId(ids, item.id, index + delta), item.id),
            })}
          </GridListItem>
        ))}
      </GridList>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  )
}

/**
 * Drag handle. Pointer users can drag the whole item (react-aria makes the button itself
 * transparent to the mouse); the button is the keyboard / screen-reader way to start a drag.
 */
export function DragHandle({ label, isDisabled }: { label: string; isDisabled?: boolean }) {
  return (
    <span className={styles.handleArea} data-disabled={isDisabled || undefined}>
      <AriaButton slot="drag" aria-label={label} isDisabled={isDisabled} className={styles.handle}>
        <IconGripVertical size={18} stroke={2} aria-hidden="true" />
      </AriaButton>
    </span>
  )
}

export interface MoveButtonsProps {
  controls: SortableControls
  earlierLabel: string
  laterLabel: string
  /** Arrow direction: vertical lists use ↑/↓, wrapping grids ←/→. */
  orientation?: 'vertical' | 'horizontal'
  className?: string
}

/** Keyboard-friendly alternative to dragging: one step earlier / later. */
export function MoveButtons({ controls, earlierLabel, laterLabel, orientation = 'vertical', className }: MoveButtonsProps) {
  const { index, total, isDisabled, move } = controls
  const earlierRef = useRef<HTMLButtonElement>(null)
  const laterRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef<-1 | 1 | null>(null)

  // Moving re-inserts the item in the DOM, which drops focus: put it back on the same button,
  // or on its sibling when the item reached an end (the pressed button is now disabled).
  useEffect(() => {
    const direction = refocus.current
    if (direction === null) return
    refocus.current = null
    ;(direction === -1 ? earlierRef : laterRef).current?.focus()
  })

  function press(delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= total) return
    const atEnd = target === 0 || target === total - 1
    refocus.current = atEnd ? (-delta as -1 | 1) : delta
    move(delta)
  }

  return (
    <span className={cx(styles.moveButtons, className)}>
      <IconButton
        ref={earlierRef}
        size="sm"
        label={earlierLabel}
        icon={orientation === 'vertical' ? IconChevronUp : IconChevronLeft}
        isDisabled={isDisabled || index === 0}
        onPress={() => press(-1)}
      />
      <IconButton
        ref={laterRef}
        size="sm"
        label={laterLabel}
        icon={orientation === 'vertical' ? IconChevronDown : IconChevronRight}
        isDisabled={isDisabled || index === total - 1}
        onPress={() => press(1)}
      />
    </span>
  )
}

/** "Saving the order…" / "Order saved" status shown next to a sortable list. */
export function OrderStatusText({
  status,
  savingLabel,
  savedLabel,
  className,
}: {
  status: OrderStatus
  savingLabel: string
  savedLabel: string
  className?: string
}) {
  return (
    <span className={cx(styles.orderStatus, className)} role="status">
      {status === 'saving' && (
        <>
          <Spinner size={14} decorative />
          {savingLabel}
        </>
      )}
      {status === 'saved' && (
        <>
          <IconCheck size={15} stroke={2.4} aria-hidden="true" className={styles.savedIcon} />
          {savedLabel}
        </>
      )}
    </span>
  )
}
