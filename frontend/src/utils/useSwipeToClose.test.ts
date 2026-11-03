import { describe, expect, it } from 'vitest'
import { releaseVelocity, swipeCloses } from './useSwipeToClose'

// The gesture itself is covered where it is used: PhotoViewer.test.tsx and Modal.test.tsx.
describe('swipe release', () => {
  it('measures the speed of the last moves only', () => {
    expect(releaseVelocity([], 100)).toBe(0)
    expect(releaseVelocity([[90, 40]], 100)).toBe(0)
    expect(releaseVelocity([[100, 40], [100, 90]], 100)).toBe(0)
    expect(
      releaseVelocity(
        [
          [0, 0],
          [120, 300],
          [160, 340],
          [200, 400],
        ],
        200,
      ),
    ).toBe(1.25)
    // Held still for a while before letting go.
    expect(
      releaseVelocity(
        [
          [0, 0],
          [16, 60],
        ],
        400,
      ),
    ).toBe(0)
    expect(
      releaseVelocity(
        [
          [0, 200],
          [20, 160],
        ],
        20,
      ),
    ).toBe(-2)
  })

  it('closes past 15% of the height, counting what the speed would add', () => {
    expect(swipeCloses(120, 0, 800)).toBe(true)
    expect(swipeCloses(119, 0, 800)).toBe(false)
    expect(swipeCloses(40, 0.5, 800)).toBe(true)
    // Let go slowly, short of the line: it stays.
    expect(swipeCloses(60, 0.25, 800)).toBe(false)
    // Thrown back up: it stays too.
    expect(swipeCloses(200, -1, 800)).toBe(false)
  })
})