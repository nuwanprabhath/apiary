/**
 * Mounts the whole renderer — exactly what main.tsx mounts — against a fake `window.apiary`, in a
 * real Chromium page (Vitest browser mode), with the app's own stylesheet. Real layout and real
 * pointer events, no Electron, no main process, no fixture home: a component test costs tens of
 * milliseconds where the same test end-to-end costs a launch.
 */
import { createRoot, type Root } from 'react-dom/client'
import { page } from '@vitest/browser/context'
import { expect } from 'vitest'
import { App } from '../../src/renderer/App'
import { NotificationProvider } from '../../src/renderer/state/notifications'
import { NotificationCenter } from '../../src/renderer/components/NotificationCenter'
import { ErrorBoundary } from '../../src/renderer/components/ErrorBoundary'
import { applyTheme } from '../../src/renderer/theme/applyTheme'
import '../../src/renderer/fonts'
import '../../src/renderer/styles.css'
import '../../src/renderer/scrollMarks'
import { createFakeApiary, type FakeApiary, type FakeOptions } from './fakeApiary'

let mounted: { root: Root; host: HTMLElement } | null = null

export interface Rendered { fake: FakeApiary }

export async function renderApp(opts: FakeOptions = {}): Promise<Rendered> {
  unmountApp()
  const fake = createFakeApiary(opts)
  window.apiary = fake
  applyTheme(fake.initialTheme.active)
  const host = document.createElement('div')
  host.id = 'root'
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(
    <NotificationProvider>
      <ErrorBoundary label="Apiary">
        <App />
      </ErrorBoundary>
      <NotificationCenter />
    </NotificationProvider>,
  )
  mounted = { root, host }
  await expect.element(page.getByTestId('sidebar')).toBeVisible()
  return { fake }
}

export function unmountApp(): void {
  if (mounted === null) return
  mounted.root.unmount()
  mounted.host.remove()
  mounted = null
}
