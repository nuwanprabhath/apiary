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
