import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useToday } from './useToday'

afterEach(() => {
  vi.useRealTimers()
})

it('moves on to the next day at midnight, and when the page comes back after it', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(2026, 10, 17, 23, 59, 0))
  const { result } = renderHook(() => useToday())
  expect(result.current).toBe('2026-11-17')

  act(() => vi.advanceTimersByTime(59_000))
  expect(result.current).toBe('2026-11-17')
  act(() => vi.advanceTimersByTime(2_000))
  expect(result.current).toBe('2026-11-18')

  // A sleeping tab can miss the timer: the day is checked again when the page is shown.
  vi.setSystemTime(new Date(2026, 10, 20, 9, 0, 0))
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(result.current).toBe('2026-11-20')
})
