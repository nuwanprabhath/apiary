import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** The chat's MCP servers (`/mcp`): every status a row can be in, a server's tools, and a sign-in under way. */
describe('UI: the MCP card', () => {
  it('servers by scope, with a failed one, a disabled one, tools open and a sign-in under way', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    fake.state.mcpServers = [
      ...fake.state.mcpServers,
      { name: 'claude.ai Google Calendar', status: 'needs-auth', scope: 'claudeai', transport: 'claudeai-proxy', error: null, tools: [], version: null },
      { name: 'slack-multi-workspace', status: 'failed', scope: 'local', transport: 'stdio', error: 'spawn uv ENOENT: uv is not on the PATH of the login shell', tools: [], version: null },
      { name: 'cypress-inspect', status: 'disabled', scope: 'user', transport: 'stdio', error: null, tools: [], version: '0.21.0' },
    ]
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.fill(page.getByTestId('composer-input'), '/mcp')
    await userEvent.keyboard('{Enter}')
    await until(() => document.querySelector('[data-testid="chat-mcp-server"][data-name="files"]') !== null)
    await reviewUi('mcp card servers')
    await userEvent.click(document.querySelector<HTMLElement>('[data-name="files"] [data-testid="chat-mcp-tools-toggle"]')!)
    await userEvent.click(document.querySelector<HTMLElement>('[data-name="tracker"] [data-testid="chat-mcp-sign-in"]')!)
    await until(() => document.querySelector('[data-testid="chat-mcp-sign-in-note"]') !== null)
    await reviewUi('mcp card signing in')
  })
})
