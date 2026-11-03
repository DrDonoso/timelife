import { describe, expect, it } from 'vitest'
import { DEFAULT_DIRECTIONS, frameFor, frameOf, mirror, sameFrame } from './direction'

describe('timeline directions', () => {
  it('maps each direction (oldest → newest) to an orientation and the side of the newest milestone', () => {
    expect(frameOf('right_to_left', false)).toEqual({ orientation: 'horizontal', reversed: false, compact: false })
    expect(frameOf('left_to_right', false)).toEqual({ orientation: 'horizontal', reversed: true, compact: false })
    expect(frameOf('bottom_to_top', true)).toEqual({ orientation: 'vertical', reversed: false, compact: true })
    expect(frameOf('top_to_bottom', true)).toEqual({ orientation: 'vertical', reversed: true, compact: true })
  })

  it('picks the setting of the screen size; the defaults keep the original layout', () => {
    const directions = { desktop: 'top_to_bottom', mobile: 'left_to_right' } as const
    expect(frameFor(directions, false)).toEqual({ orientation: 'vertical', reversed: true, compact: false })
    expect(frameFor(directions, true)).toEqual({ orientation: 'horizontal', reversed: true, compact: true })
    expect(frameFor(DEFAULT_DIRECTIONS, false)).toEqual({ orientation: 'horizontal', reversed: false, compact: false })
    expect(frameFor(DEFAULT_DIRECTIONS, true)).toEqual({ orientation: 'vertical', reversed: false, compact: true })
  })

  it('mirrors positions in reversed frames only (an involution)', () => {
    expect(mirror(120, 1000, false)).toBe(120)
    expect(mirror(120, 1000, true)).toBe(880)
    expect(mirror(mirror(345, 1000, true), 1000, true)).toBe(345)
  })

  it('compares frames field by field', () => {
    expect(sameFrame(frameOf('left_to_right', false), { orientation: 'horizontal', reversed: true, compact: false })).toBe(true)
    expect(sameFrame(frameOf('left_to_right', false), frameOf('left_to_right', true))).toBe(false)
    expect(sameFrame(frameOf('left_to_right', false), frameOf('right_to_left', false))).toBe(false)
  })
})
