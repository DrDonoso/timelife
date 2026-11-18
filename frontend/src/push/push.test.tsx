import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PushEndpointIn, PushSubscriptionIn } from '../api/schema.gen'
import { VIEWER_SESSION, mockSignedIn, renderApp, reply, type MockRequest } from '../utils/test-utils'
import { INVITE_DELAY_MS } from './PushInvite'
import { base64UrlBytes } from './support'

// The server's VAPID key, and the one it had before a new AUTH_SECRET.
const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const OLD_KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const ENDPOINT = 'https://web.push.apple.com/QGuQyavXutnMH'
const SWITCH = 'Activar notificaciones'
const ACCOUNT = 'Menú de usuario: Vera Viewer'

class FakeSubscription {
  readonly endpoint: string
  readonly options: { applicationServerKey: ArrayBuffer | null }
  readonly unsubscribe: () => Promise<boolean>

  constructor(browser: FakeBrowser, endpoint: string, key: string) {
    this.endpoint = endpoint
    this.options = { applicationServerKey: base64UrlBytes(key).buffer }
    this.unsubscribe = vi.fn(async () => {
      browser.subscription = null
      return true
    })
  }

  toJSON() {
    return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'BBrowserKey', auth: 'AuthSecret' } }
  }
}

interface FakeBrowserOptions {
  /** `Notification.permission` before asking. */
  permission?: NotificationPermission
  /** What the person answers when asked. */
  answer?: NotificationPermission
  /** The key of a subscription the browser already has. */
  subscribedWith?: string
  /** Opened from the Home Screen. */
  standalone?: boolean
}

/** A browser with service workers and the Push API (jsdom has neither). */
class FakeBrowser {
  subscription: FakeSubscription | null = null
  readonly notification: { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> }
  readonly subscribe = vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
    const key = btoa(String.fromCharCode(...applicationServerKey)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    this.subscription = new FakeSubscription(this, `${ENDPOINT}-${key.slice(-6)}`, key)
    return this.subscription
  })
  readonly register = vi.fn(async () => this.registration)
  readonly registration = {
    pushManager: { getSubscription: async () => this.subscription, subscribe: this.subscribe },
  }

  constructor({ permission = 'default', answer = 'granted', subscribedWith, standalone = false }: FakeBrowserOptions = {}) {
    if (subscribedWith) this.subscription = new FakeSubscription(this, ENDPOINT, subscribedWith)
    const notification = {
      permission,
      requestPermission: vi.fn(async () => {
        notification.permission = answer
        return answer
      }),
    }
    this.notification = notification
    vi.stubGlobal('Notification', notification)
    vi.stubGlobal('PushManager', {})
    vi.stubGlobal('isSecureContext', true)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: this.register, ready: Promise.resolve(this.registration), getRegistration: async () => this.registration },
    })
    if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
  }
}

function fakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  return new FakeBrowser(options)
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
  Reflect.deleteProperty(navigator, 'standalone')
  Reflect.deleteProperty(navigator, 'userAgent')
})

/** Signed in as Vera (user 2); returns the requests to /api/push. */
function signedIn(extra: Record<string, unknown> = {}) {
  const sent: { registered: PushSubscriptionIn[]; removed: PushEndpointIn[]; tested: PushEndpointIn[] } = {
    registered: [],
    removed: [],
    tested: [],
  }
  mockSignedIn(VIEWER_SESSION, {
    'GET /api/push': { public_key: KEY },
    'PUT /api/push/subscription': ({ body }: MockRequest) => {
      sent.registered.push(body as PushSubscriptionIn)
      return reply(204)
    },
    'POST /api/push/unsubscribe': ({ body }: MockRequest) => {
      sent.removed.push(body as PushEndpointIn)
      return reply(204)
    },
    'POST /api/push/test': ({ body }: MockRequest) => {
      sent.tested.push(body as PushEndpointIn)
      return reply(204)
    },
    'GET /api/timeline': { child_id: null, total: 0, events: [] },
    'GET /api/children/1/timeline': { child_id: 1, total: 0, events: [] },
    ...extra,
  })
  return sent
}

async function openAccount(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: ACCOUNT }))
  return screen.findByRole('dialog', { name: 'Menú de usuario' })
}

describe('notifications in the account panel', () => {
  it('turns them on for this device, sends a test and turns them off', async () => {
    const browser = fakeBrowser()
    const sent = signedIn()
    const user = userEvent.setup()
    renderApp('/c/ana')

    let panel = await openAccount(user)
    const toggle = within(panel).getByRole('switch', { name: SWITCH })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription('Recibirás en este dispositivo los recuerdos de cada día, a las 9:00.')
    await user.click(toggle)

    expect(await screen.findByText('Listo: las notificaciones están activadas en este dispositivo.')).toBeInTheDocument()
    expect(browser.notification.requestPermission).toHaveBeenCalledOnce()
    expect(browser.register).toHaveBeenCalledWith('/sw.js')
    expect(browser.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(KEY) })
    const endpoint = browser.subscription?.endpoint
    expect(sent.registered).toEqual([
      { endpoint, keys: { p256dh: 'BBrowserKey', auth: 'AuthSecret' }, locale: 'es', time_zone: expect.any(String) },
    ])
    expect(localStorage.getItem('timelife.push')).toBe('2')
    expect(toggle).toBeChecked()

    await user.click(within(panel).getByRole('button', { name: 'Enviar una notificación de prueba' }))
    expect(await screen.findByText('Notificación enviada: llegará en unos segundos.')).toBeInTheDocument()
    expect(sent.tested).toEqual([{ endpoint }])

    panel = screen.getByRole('dialog', { name: 'Menú de usuario' })
    await user.click(within(panel).getByRole('switch', { name: SWITCH }))
    await waitFor(() => expect(within(panel).getByRole('switch', { name: SWITCH })).not.toBeChecked())
    expect(sent.removed).toEqual([{ endpoint }])
    expect(browser.subscription).toBeNull()
    expect(localStorage.getItem('timelife.push')).toBeNull()
  })

  it('stays off when the permission is refused, and then says where to allow them', async () => {
    fakeBrowser({ answer: 'denied' })
    const sent = signedIn()
    const user = userEvent.setup()
    renderApp('/c/ana')

    const panel = await openAccount(user)
    await user.click(within(panel).getByRole('switch', { name: SWITCH }))
    expect(
      await within(panel).findByText(/^Las notificaciones de Timelife están bloqueadas en este dispositivo/),
    ).toBeInTheDocument()
    expect(within(panel).queryByRole('switch')).not.toBeInTheDocument()
    expect(sent.registered).toEqual([])
  })

  it('tells iPhone users to add the app to the Home Screen first, and says nothing where browsers cannot', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
    })
    signedIn()
    const user = userEvent.setup()
    const { unmount } = renderApp('/c/ana')
    let panel = await openAccount(user)
    expect(within(panel).getByText(/^Para recibir notificaciones en el iPhone o el iPad, añade Timelife a la pantalla de inicio/)).toBeInTheDocument()
    expect(within(panel).queryByRole('switch')).not.toBeInTheDocument()
    unmount()

    Reflect.deleteProperty(navigator, 'userAgent')
    renderApp('/c/ana')
    panel = await openAccount(user)
    expect(within(panel).queryByRole('group', { name: 'Notificaciones de este dispositivo' })).not.toBeInTheDocument()
  })
})

describe('the registration of this device', () => {
  it('is refreshed each time the app opens, with a new subscription when the server’s key changed', async () => {
    localStorage.setItem('timelife.push', '2')
    const browser = fakeBrowser({ permission: 'granted', subscribedWith: OLD_KEY })
    const old = browser.subscription
    const sent = signedIn()
    renderApp('/c/ana')

    await waitFor(() => expect(sent.registered).toHaveLength(1))
    expect(old?.unsubscribe).toHaveBeenCalledOnce()
    expect(sent.removed).toEqual([{ endpoint: ENDPOINT }])
    expect(browser.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(KEY) })
    expect(sent.registered[0].endpoint).toBe(browser.subscription?.endpoint)
    expect(browser.notification.requestPermission).not.toHaveBeenCalled()
  })

  it('is left alone when someone else turned them on in this browser', async () => {
    localStorage.setItem('timelife.push', '1')
    fakeBrowser({ permission: 'granted', subscribedWith: KEY })
    const sent = signedIn()
    const user = userEvent.setup()
    renderApp('/c/ana')

    const panel = await openAccount(user)
    expect(within(panel).getByRole('switch', { name: SWITCH })).not.toBeChecked()
    expect(sent.registered).toEqual([])
  })
})

describe('the invite of the installed app', () => {
  it('offers them once, the first time it opens on a timeline', async () => {
    const browser = fakeBrowser({ standalone: true })
    const sent = signedIn()
    const user = userEvent.setup()
    const { unmount } = renderApp('/c/ana')

    const invite = await screen.findByText('¿Activamos las notificaciones? Te avisaremos de los recuerdos de cada día.', {}, { timeout: INVITE_DELAY_MS + 4000 })
    expect(localStorage.getItem('timelife.pushInvite')).toBe('1')
    await user.click(within(invite.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Activar' }))
    expect(await screen.findByText('Listo: las notificaciones están activadas en este dispositivo.')).toBeInTheDocument()
    expect(browser.notification.requestPermission).toHaveBeenCalledOnce()
    expect(sent.registered).toHaveLength(1)
    unmount()

    // Never again on this device.
    browser.notification.permission = 'default'
    renderApp('/c/ana')
    await screen.findByRole('button', { name: ACCOUNT })
    await new Promise((resolve) => setTimeout(resolve, INVITE_DELAY_MS + 300))
    expect(screen.queryByText(/^¿Activamos las notificaciones/)).not.toBeInTheDocument()
  })

  it('is not offered in a browser tab', async () => {
    fakeBrowser()
    signedIn()
    renderApp('/c/ana')
    await screen.findByRole('button', { name: ACCOUNT })
    await new Promise((resolve) => setTimeout(resolve, INVITE_DELAY_MS + 300))
    expect(screen.queryByText(/^¿Activamos las notificaciones/)).not.toBeInTheDocument()
  })
})
