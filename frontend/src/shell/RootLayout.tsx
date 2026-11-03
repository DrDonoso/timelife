import { RouterProvider as AriaRouterProvider } from 'react-aria-components'
import { Outlet, useNavigate } from 'react-router'
import { CurrentChildProvider } from '../contexts/CurrentChildContext'
import { ToastProvider } from '../contexts/ToastContext'
import { IS_DEMO } from '../demo/config'
import { DemoWelcome } from '../demo/DemoWelcome'

/**
 * Root route element: providers that need the router (client-side navigation for react-aria
 * links/menu items, the current child from the URL, toasts with in-app links).
 */
export function RootLayout() {
  const navigate = useNavigate()
  return (
    <AriaRouterProvider navigate={navigate}>
      <CurrentChildProvider>
        <ToastProvider>
          {IS_DEMO && <DemoWelcome />}
          <Outlet />
        </ToastProvider>
      </CurrentChildProvider>
    </AriaRouterProvider>
  )
}
