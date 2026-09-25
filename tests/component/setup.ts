import { afterEach } from 'vitest'
import { createFakeApiary } from './fakeApiary'
import { unmountApp } from './renderApp'

// Installed before any test file imports the renderer, for code that reads the bridge as a module
// loads; `renderApp` replaces it with the test's own fake.
window.apiary = createFakeApiary()

afterEach(() => {
  unmountApp()
  // The renderer keeps UI state (collapsed folders, widths, pins, the open tab) in localStorage,
  // per window — cleared so no test starts where the last one left off.
  localStorage.clear()
})
