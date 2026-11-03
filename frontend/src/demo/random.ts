/** Seeded pseudo-random numbers (mulberry32): the demo looks the same on every visit. */
export class Random {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Uniform float in [0, 1). */
  random(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform float in [low, high). */
  uniform(low: number, high: number): number {
    return low + (high - low) * this.random()
  }

  /** Integer in [0, stop). */
  below(stop: number): number {
    return Math.floor(this.random() * stop)
  }

  /** Integer in [low, high], both included. */
  between(low: number, high: number): number {
    return low + this.below(high - low + 1)
  }

  choice<T>(items: readonly T[]): T {
    return items[this.below(items.length)]
  }

  /** New array with the items in random order (Fisher–Yates). */
  shuffled<T>(items: readonly T[]): T[] {
    const result = [...items]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.below(index + 1)
      ;[result[index], result[other]] = [result[other], result[index]]
    }
    return result
  }

  uint32(): number {
    return Math.floor(this.random() * 4294967296) >>> 0
  }

  /** Random UUID in the version 4 layout. */
  uuid(): string {
    const hex = Array.from({ length: 32 }, () => this.below(16).toString(16)).join('')
    const variant = (8 + this.below(4)).toString(16)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  }
}
