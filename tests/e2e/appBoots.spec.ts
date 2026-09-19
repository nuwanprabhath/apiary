import { test, expect } from '@playwright/test'
import { launchApiary, type Harness } from './helpers'

/**
 * The main process starts and paints a window.
 *
 * Every other spec launches the app too, so this asserts nothing they do not. It exists to make a
 * boot failure *legible*: when the main process dies on load, all two hundred and fifty tests fail
 * with whatever each one was waiting for, and the actual error — one line in one stack trace —
 * is buried. Named and ordered first, this one says "the app does not start" in the summary.
 *
 * The failure that prompted it: `@xterm/headless` is CommonJS and the main bundle is ESM, so a
 * named import of it compiled fine, typechecked fine, passed every unit test, and then threw
 * `Named export 'Terminal' not found` the instant Electron loaded the bundle. Nothing before this
 * layer can see that class of bug — it is created by how the code is *bundled*, not by how it is
 * written, so neither `tsc` nor a linter is looking at the artifact that breaks.
 */
let h: Harness
test.afterEach(async () => { await h.close() })

test('the main process boots and renders a window', async () => {
  h = await launchApiary()
  await expect(h.page.getByTestId('sidebar')).toBeVisible()
})
