import { describe, expect, it, vi } from 'vitest'
import { consumeMemoriesIntent, takeLaunchIntent } from './launch'

const at = (href: string) => ({ href }) as Location

describe('the intent of a notification', () => {
  it('is taken out of the address, keeping the rest of it, and acted on once', () => {
    const history = { state: { key: 'page' }, replaceState: vi.fn() } as unknown as History
    takeLaunchIntent(at('https://timelife.example/c/ana/e/1?zoom=events&memories=seen&focus=e1#top'), history)
    expect(history.replaceState).toHaveBeenCalledWith({ key: 'page' }, '', '/c/ana/e/1?zoom=events&focus=e1#top')
    expect(consumeMemoriesIntent()).toBe('seen')
    expect(consumeMemoriesIntent()).toBeNull()

    takeLaunchIntent(at('https://timelife.example/?memories=open'), history)
    expect(history.replaceState).toHaveBeenLastCalledWith({ key: 'page' }, '', '/')
    expect(consumeMemoriesIntent()).toBe('open')
  })

  it('leaves other addresses alone', () => {
    const history = { state: null, replaceState: vi.fn() } as unknown as History
    takeLaunchIntent(at('https://timelife.example/c/ana?memories=everything'), history)
    takeLaunchIntent(at('https://timelife.example/c/ana'), history)
    expect(history.replaceState).not.toHaveBeenCalled()
    expect(consumeMemoriesIntent()).toBeNull()
  })
})
