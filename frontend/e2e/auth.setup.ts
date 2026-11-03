import { expect, test as setup } from '@playwright/test'
import type { SessionOut } from '../src/api/schema.gen'
import { DEV_PASSWORD, MUTATION_HEADERS, storageStateOf, type Role } from './support'

// The development sign-in (enabled by scripts/e2e_server.py) for both roles; the other projects
// start from these saved sessions. Tests that sign out use their own session instead.
for (const role of ['admin', 'viewer'] satisfies Role[]) {
  setup(`sign in as the development ${role}`, async ({ request }) => {
    const response = await request.post('/api/auth/dev-login', {
      data: { username: role, password: DEV_PASSWORD },
      headers: MUTATION_HEADERS,
    })
    expect(response.status()).toBe(200)
    const session = (await response.json()) as SessionOut
    expect(session.user?.role).toBe(role)
    await request.storageState({ path: storageStateOf(role) })
  })
}
