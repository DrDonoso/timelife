import '@fontsource-variable/nunito'
import './styles/tokens.css'
import './styles/themes.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Timelife: the #root element is missing from index.html')
const root = container

function render() {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

/** Plain DOM (React never mounted): the demo cannot run without its service worker. */
function demoUnavailable() {
  const box = document.createElement('div')
  box.style.cssText =
    'max-width:34rem;margin:15vh auto;padding:1.5rem;border:1px solid #e7ddd3;border-radius:16px;' +
    'background:#fff;color:#2b2420;font:15px/1.55 system-ui,sans-serif'
  const title = document.createElement('strong')
  title.textContent = 'The demo could not start'
  const text = document.createElement('p')
  text.style.margin = '0.5rem 0 0'
  text.textContent =
    'This demo runs entirely in your browser and needs service workers: open it over HTTPS in a regular ' +
    '(not private) window of an up-to-date browser.'
  box.append(title, text)
  root.replaceChildren(box)
}

// The public demo (`--mode demo`) answers the API in the browser: its service worker must be
// running before the first request. The literal check lets the bundler drop the demo (and MSW)
// from normal builds.
if (import.meta.env.VITE_DEMO === '1') {
  import('./demo/browser')
    .then(({ startDemo }) => startDemo())
    .then(render, (error: unknown) => {
      console.error('Timelife demo: the mock service worker did not start', error)
      demoUnavailable()
    })
} else {
  render()
}
