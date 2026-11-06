import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/**
 * `/mcp` in a chat: Claude Code's terminal `/mcp` dialog, as a card over the message box that reads
 * and drives the chat's MCP servers (`chatMcp`) instead of sending `/mcp` to Claude. The fake has
 * fake-claude-chat.mjs's two servers: `files` (user, connected, two tools), `tracker` (project,
 * needs a sign-in).
 */
const TITLE = 'Fix CSV export bug'

async function openMcp() {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  await userEvent.fill(page.getByTestId('composer-input'), '/mcp')
  await userEvent.keyboard('{Enter}')
  return { fake, sessionId }
}

const row = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="chat-mcp-server"][data-name="${name}"]`)!
const statusOf = (name: string): string => row(name)?.querySelector('[data-testid="chat-mcp-status"]')?.textContent ?? ''

describe('the MCP card', () => {
  it('/mcp opens the servers by where they are configured, starting the chat, and sends nothing to Claude', async () => {
    const { fake, sessionId } = await openMcp()
    await expect.element(page.getByTestId('chat-mcp')).toBeVisible()
    await expect.poll(() => page.getByTestId('chat-mcp-summary').element().textContent).toBe('1 connected · 1 need sign-in')
    expect(fake.callsTo('chatStart')).toEqual([[sessionId, { takeOver: true }]])
    expect(fake.callsTo('chatSend')).toEqual([])
    const groups = [...document.querySelectorAll('.chat-mcp-group-label')].map((g) => g.textContent)
    expect(groups).toEqual(['Project: .mcp.json', 'User: every folder'])
    expect(statusOf('files')).toBe('Connected')
    expect(statusOf('tracker')).toBe('Needs sign-in')
    // The message box is empty again: /mcp went to the card.
    await expect.element(page.getByTestId('composer-input')).toHaveValue('')
  })

  it('lists a server\'s tools, and disables and enables it', async () => {
    await openMcp()
    await until(() => row('files') !== null)
    await userEvent.click(row('files').querySelector<HTMLElement>('[data-testid="chat-mcp-tools-toggle"]')!)
    expect([...row('files').querySelectorAll('.chat-mcp-tool')].map((t) => t.textContent)).toEqual(['read', 'write'])
    await userEvent.click(row('files').querySelector<HTMLElement>('[data-testid="chat-mcp-toggle"]')!)
    await expect.poll(() => statusOf('files')).toBe('Disabled')
    expect(row('files').querySelector('[data-testid="chat-mcp-reconnect"]')).toBeNull()
    await userEvent.click(row('files').querySelector<HTMLElement>('[data-testid="chat-mcp-toggle"]')!)
    await expect.poll(() => statusOf('files')).toBe('Connected')
  })

  it('signs in: the page opens from a link, and a pasted redirect finishes it; claude\'s refusal shows in the card', async () => {
    await openMcp()
    await until(() => row('tracker') !== null)
    await userEvent.click(row('tracker').querySelector<HTMLElement>('[data-testid="chat-mcp-sign-in"]')!)
    await expect.element(page.getByTestId('chat-mcp-sign-in-link')).toHaveAttribute('href', 'https://auth.example.com/tracker?state=s1')
    await expect.element(page.getByTestId('chat-mcp-sign-in-link')).toHaveAttribute('target', '_blank')
    await userEvent.fill(page.getByTestId('chat-mcp-callback'), 'http://localhost:4567/callback')
    await userEvent.click(page.getByTestId('chat-mcp-callback-send'))
    await expect.element(page.getByTestId('chat-mcp-error')).toMatchTextContent(/missing authorization code/)
    await userEvent.fill(page.getByTestId('chat-mcp-callback'), 'http://localhost:4567/callback?code=abc&state=s1')
    await userEvent.click(page.getByTestId('chat-mcp-callback-send'))
    await expect.poll(() => statusOf('tracker')).toBe('Connected')
    // Signed in: the note goes, and an http server can be signed out of.
    await expect.element(page.getByTestId('chat-mcp-sign-in-note')).not.toBeInTheDocument()
    expect(row('tracker').querySelector('[data-testid="chat-mcp-sign-out"]')).not.toBeNull()
    expect(row('files').querySelector('[data-testid="chat-mcp-sign-out"]')).toBeNull()
  })

  it('leaves a busy terminal alone: it says why, and starts no chat', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession(TITLE))
    const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
    await userEvent.click(page.getByTestId('resume-button'))
    await userEvent.click(page.getByTestId('view-transcript'))
    fake.state.terminalBusy.set(sessionId, { busy: true, backgroundTasks: 0 })
    await userEvent.fill(page.getByTestId('composer-input'), '/mcp')
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('chat-mcp-unavailable')).toMatchTextContent(/working in this session’s terminal/)
    expect(fake.callsTo('chatStart')).toEqual([])
    expect(fake.callsTo('sendPrompt')).toEqual([])
  })

  it('Escape inside the card, or ×, puts it away', async () => {
    await openMcp()
    await until(() => row('files') !== null)
    row('files').querySelector<HTMLElement>('[data-testid="chat-mcp-toggle"]')!.focus()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('chat-mcp')).not.toBeInTheDocument()
    await userEvent.fill(page.getByTestId('composer-input'), '/mcp')
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('chat-mcp')).toBeVisible()
    await userEvent.click(page.getByTestId('chat-mcp-close'))
    await expect.element(page.getByTestId('chat-mcp')).not.toBeInTheDocument()
  })
})
