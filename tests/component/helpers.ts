/**
 * The component-test counterparts of tests/e2e/helpers.ts's DOM helpers, so a test moved down a
 * layer reads the same as it did.
 */
import { commands, page, userEvent, type Locator } from '@vitest/browser/context'
import { expect } from 'vitest'

/** A session's row in the sidebar (tree, Pinned, Recent or Active), by its exact title. */
export function sidebarSession(title: string): Locator {
  return page.getByTestId('sidebar').getByText(title, { exact: true })
}

/** Every session row (tree, Pinned, Recent — not Active) whose text contains `title`. */
export function sessionRows(title: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid="session-item"]')]
    .filter((el) => el.textContent?.includes(title) === true)
}

/**
 * The first session row for `title`, once there is one. An element, not a locator: `userEvent`
 * takes either, and a locator made from an element becomes a query by accessible name, which
 * changes under a hover (the row's age gives way to its buttons).
 */
export async function sessionRow(title: string): Promise<HTMLElement> {
  await until(() => sessionRows(title).length > 0)
  return sessionRows(title)[0]
}

/** Hovers a session row and clicks one of its hover-revealed buttons (pin, split, remove, note). */
export async function clickRowAction(title: string, testId: string): Promise<void> {
  const row = await sessionRow(title)
  const wrap = row.closest<HTMLElement>('.session-row-wrap') ?? row
  await userEvent.hover(wrap)
  const button = wrap.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`No ${testId} on the row "${title}"`)
  await userEvent.click(button)
}

/** The element's box, as `getBoundingClientRect` reports it — for the geometry checks. */
export function box(locator: Locator): DOMRect {
  return locator.element().getBoundingClientRect()
}

/** The real mouse, at coordinates inside the test page (see commands.ts). */
export const mouse = {
  move: (x: number, y: number, steps = 1) => commands.mouse('move', x, y, steps),
  down: () => commands.mouse('down'),
  up: () => commands.mouse('up'),
  wheel: (dx: number, dy: number) => commands.mouse('wheel', dx, dy),
}

/** Drags from the centre of `from` by (dx, dy), in steps, with the real mouse. */
export async function drag(from: Element, dx: number, dy: number, steps = 6): Promise<void> {
  const r = from.getBoundingClientRect()
  const x = r.x + r.width / 2
  const y = r.y + r.height / 2
  await mouse.move(x, y)
  await mouse.down()
  await mouse.move(x + dx, y + dy, steps)
  await mouse.up()
}

/** Waits until `check` holds, as Playwright's `expect.poll` does. */
export async function until(check: () => boolean | Promise<boolean>, timeout = 3000): Promise<void> {
  await expect.poll(check, { timeout }).toBe(true)
}
