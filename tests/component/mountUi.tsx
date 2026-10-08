/**
 * Mounts one `ui/` primitive on its own in the real Chromium page, with the app's stylesheet — for
 * a test about the primitive's keyboard and focus contract, where booting the whole app (renderApp)
 * would only add noise. Unmounted after every test.
 */
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach } from 'vitest'
import '../../src/renderer/styles.css'

const mounted: Array<{ root: Root; host: HTMLElement }> = []

export interface Mounted {
  /** Renders `node` in place of what was mounted, keeping state — a prop change. */
  rerender: (node: ReactNode) => Promise<void>
}

export async function mountUi(node: ReactNode): Promise<Mounted> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  flushSync(() => { root.render(node) })
  return {
    rerender: (next) => { flushSync(() => { root.render(next) }); return Promise.resolve() },
  }
}

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    root.unmount()
    host.remove()
  }
})
