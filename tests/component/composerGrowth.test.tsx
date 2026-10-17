import { describe, it, expect, vi, afterEach } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'

const TITLE = 'Fix CSV export bug'
const NEWLINE = '{Shift>}{Enter}{/Shift}'

afterEach(() => { vi.restoreAllMocks() })

describe('message box growth', () => {
  it('typing reads no scrollHeight from the box, yet it grows with its text and stops at the cap', async () => {
    await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession(TITLE))
    const input = page.getByTestId('composer-input')
    await expect.element(input).toBeVisible()
    const box = document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')!
    const one = box.getBoundingClientRect().height

    const reads: unknown[] = []
    const real = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')!
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      reads.push(this)
      return (real.get as () => number).call(this)
    })
    await userEvent.click(input)
    await userEvent.keyboard('x'.repeat(20))
    expect(reads).toEqual([])

    await userEvent.keyboard(NEWLINE.repeat(4) + 'tall')
    expect(box.getBoundingClientRect().height).toBeGreaterThan(one)
    await userEvent.keyboard(NEWLINE.repeat(80))
    const cap = window.innerHeight * 0.4
    expect(box.getBoundingClientRect().height).toBeLessThanOrEqual(cap + 1)
    expect(box.getBoundingClientRect().height).toBeGreaterThan(cap - 40)
    expect(reads).toEqual([])
  })
})
