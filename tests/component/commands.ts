/**
 * Server-side commands for the component tests, run by Vitest in Node against the Playwright page
 * that hosts the test iframe. Browser mode's `userEvent` has no raw pointer: these give the tests
 * that drag a divider or trace a path across a row the real mouse, at page coordinates the test
 * computed from `getBoundingClientRect` inside the iframe.
 */
import type { Frame, Page } from 'playwright'
import type { BrowserCommand } from 'vitest/node'

type MouseAction = 'move' | 'down' | 'up' | 'wheel'

export const mouse: BrowserCommand<[action: MouseAction, x?: number, y?: number, steps?: number]> = async (ctx, action, x = 0, y = 0, steps = 1) => {
  if (ctx.provider.name !== 'playwright') throw new Error('mouse needs the Playwright provider')
  const page = (ctx as unknown as { page: Page }).page
  const frame = await (ctx as unknown as { frame(): Promise<Frame> }).frame()
  const offset = (await (await frame.frameElement()).boundingBox()) ?? { x: 0, y: 0 }
  if (action === 'move') await page.mouse.move(offset.x + x, offset.y + y, { steps })
  else if (action === 'down') await page.mouse.down()
  else if (action === 'up') await page.mouse.up()
  else await page.mouse.wheel(x, y)
}

/**
 * Sets `prefers-reduced-motion` on the real page hosting the test iframe (UI-29), so a component
 * test can assert what CSS actually does under it rather than trusting the rule was written
 * correctly. `'no-preference'` restores the default. The emulation is page-wide and outlives the
 * test that set it, so every caller resets it in an `afterEach`. (Playwright's own `null` — "no
 * emulation" — is not used here: passed across the browser-command RPC it arrives as an argument
 * vitest's own serialisation trips over.)
 */
export const emulateMedia: BrowserCommand<[reduceMotion: 'reduce' | 'no-preference']> = async (ctx, reduceMotion) => {
  if (ctx.provider.name !== 'playwright') throw new Error('emulateMedia needs the Playwright provider')
  const page = (ctx as unknown as { page: Page }).page
  await page.emulateMedia({ reducedMotion: reduceMotion })
}
