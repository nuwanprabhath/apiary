import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/** What you typed and did not send stays with its session: across tab switches, and in another window. */
const A = 'Fix CSV export bug'
const B = 'Add worktree switcher'
const input = (): HTMLTextAreaElement => page.getByTestId('composer-input').element() as HTMLTextAreaElement

describe('an unsent message', () => {
  it('is still there after switching to another tab and back, and each tab keeps its own', async () => {
    await renderApp()
    await userEvent.click(sidebarSession(A))
    await userEvent.fill(page.getByTestId('composer-input'), 'half a thought about the export')
    await userEvent.click(sidebarSession(B))
    await until(() => input().value === '')
    await userEvent.fill(page.getByTestId('composer-input'), 'something else')
    await userEvent.click(sidebarSession(A))
    await until(() => input().value === 'half a thought about the export')
    await userEvent.click(sidebarSession(B))
    await until(() => input().value === 'something else')
    expect(input().value).toBe('something else')
  })

  it('is there in another window that opens the same session (a tab dragged across)', async () => {
    await renderApp()
    await userEvent.click(sidebarSession(A))
    await userEvent.fill(page.getByTestId('composer-input'), 'carried across')
    // A second window: a fresh app over the same storage.
    await renderApp()
    await userEvent.click(sidebarSession(A))
    await until(() => input().value === 'carried across')
    expect(input().value).toBe('carried across')
  })

  it('is gone once sent', async () => {
    await renderApp()
    await userEvent.click(sidebarSession(A))
    await userEvent.fill(page.getByTestId('composer-input'), 'send me')
    await userEvent.keyboard('{Enter}')
    await until(() => input().value === '')
    await userEvent.click(sidebarSession(B))
    await userEvent.click(sidebarSession(A))
    await until(() => document.querySelector('[data-testid="composer-input"]') !== null)
    expect(input().value).toBe('')
  })
})
