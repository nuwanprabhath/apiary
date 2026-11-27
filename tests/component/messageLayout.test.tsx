import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import { message as said } from './fakeApiary'
import { message, withMrDesk } from './residentFixtures'
import { must } from './must'

const LONG = 'aws logs describe-log-groups --profile prod-profile --region ap-southeast-2 --query "logGroups[].logGroupName" --output text'.repeat(2)

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

describe('a code block\'s copy button', () => {
  it('never covers the code, however far a long line is scrolled', async () => {
    await renderApp({
      sessions: [{
        sessionId: '00000000-0000-4000-8000-0000000000c1', title: 'Log groups', projectPath: '/fixture/work-a',
        messages: [said('u1', 'user', 'How?'), said('a1', 'assistant', `Check it:\n\n\`\`\`\n${LONG}\n\`\`\``)],
      }],
    })
    await userEvent.click(sidebarSession('Log groups'))
    await until(() => document.querySelector('[data-testid="code-copy"]') !== null)
    const button = must(document.querySelector<HTMLElement>('[data-testid="code-copy"]'))
    const pre = must(button.parentElement?.querySelector('pre'))
    const code = must(pre.querySelector('code'))
    const text = document.createRange()
    text.selectNodeContents(code)
    expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth)
    for (const left of [0, pre.scrollWidth]) {
      pre.scrollLeft = left
      for (const line of text.getClientRects()) expect(overlaps(line, button.getBoundingClientRect())).toBe(false)
    }
  })
})

describe('a table in the MR desk\'s chat', () => {
  it('wraps its cells as prose wraps, instead of scrolling sideways', async () => {
    const status = 'Done. Huy agreed with Walid and Andrew to skip only the affected record. Neither has objected since, and the thread is resolved.'
    await renderApp({}, (f) => {
      withMrDesk(f)
      f.override('residentHistory', async () => [message('assistant', `| Your ask | Status |\n| --- | --- |\n| Confirm whether to block | ${status} |`)])
    })
    await until(() => document.querySelector('[data-testid="resident-badge-mr-desk"]') !== null)
    await userEvent.click(document.querySelector('[data-testid="resident-badge-mr-desk"]')!)
    await until(() => document.querySelector('.resident-popup table') !== null)
    const table = must(document.querySelector<HTMLElement>('.resident-popup table'))
    const cell = must(table.querySelectorAll<HTMLElement>('td')[1])
    expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth)
    expect(cell.getBoundingClientRect().height).toBeGreaterThan(2 * parseFloat(getComputedStyle(cell).lineHeight))
    expect(page.getByTestId('resident-popup').element().contains(cell)).toBe(true)
  })
})
