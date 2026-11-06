import { type JSX, useEffect, useState } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { McpServer, McpServerStatus, McpSignIn } from '@shared/domain/mcp'
import { closeMcp, refreshMcp, runMcp, useMcpCard } from '../../state/chatMcp'
import { reloadSession } from '../../state/sessions'
import { surface } from '../../state/policy'
import { useAppSettings } from '../../state/settingsStore'
import { BusyGlyph } from '../../ui/BusyGlyph'
import { RefreshIcon } from '../../ui/icons'

const STATUS_LABEL: Record<McpServerStatus, string> = {
  connected: 'Connected',
  pending: 'Connecting…',
  'needs-auth': 'Needs sign-in',
  failed: 'Failed',
  disabled: 'Disabled',
}

/** Where a server is configured, in the order Claude Code's `/mcp` lists them. */
const SCOPES: ReadonlyArray<[scope: string, label: string]> = [
  ['local', 'Local: this folder, only you'],
  ['project', 'Project: .mcp.json'],
  ['user', 'User: every folder'],
  ['plugin', 'Plugins'],
  ['claudeai', 'claude.ai connectors'],
  ['dynamic', 'This session'],
  ['enterprise', 'Managed'],
]

function scopeLabel(scope: string): string {
  return SCOPES.find(([s]) => s === scope)?.[1] ?? scope.charAt(0).toUpperCase() + scope.slice(1)
}

function groups(servers: readonly McpServer[]): Array<[label: string, servers: McpServer[]]> {
  const order = (scope: string): number => { const i = SCOPES.findIndex(([s]) => s === scope); return i < 0 ? SCOPES.length : i }
  const scopes = [...new Set(servers.map((s) => s.scope))].sort((a, b) => order(a) - order(b))
  return scopes.map((scope) => [scopeLabel(scope), servers.filter((s) => s.scope === scope)])
}

function summary(servers: readonly McpServer[]): string {
  const count = (status: McpServerStatus): number => servers.filter((s) => s.status === status).length
  const parts = [
    `${String(count('connected'))} connected`,
    count('needs-auth') > 0 ? `${String(count('needs-auth'))} need sign-in` : '',
    count('failed') > 0 ? `${String(count('failed'))} failed` : '',
    count('disabled') > 0 ? `${String(count('disabled'))} disabled` : '',
  ]
  return parts.filter((p) => p !== '').join(' · ')
}

/** What a row offers, by its status: what Claude Code's `/mcp` offers for one server. */
function ServerActions({ sessionId, server, busy }: { sessionId: SessionId; server: McpServer; busy: boolean }): JSX.Element {
  const run = (request: Parameters<typeof runMcp>[1]): void => { void runMcp(sessionId, request) }
  const name = server.name
  const canSignOut = server.status === 'connected' && (server.transport === 'http' || server.transport === 'sse')
  return (
    <div className="chat-mcp-actions">
      {server.status === 'needs-auth' && (
        <button type="button" className="btn small primary" data-testid="chat-mcp-sign-in" disabled={busy} onClick={() => { run({ kind: 'authenticate', server: name }) }}>Sign in</button>
      )}
      {(server.status === 'connected' || server.status === 'failed' || server.status === 'needs-auth') && (
        <button type="button" className="btn small" data-testid="chat-mcp-reconnect" disabled={busy} onClick={() => { run({ kind: 'reconnect', server: name }) }}>Reconnect</button>
      )}
      {canSignOut && (
        <button type="button" className="btn small" data-testid="chat-mcp-sign-out" disabled={busy} onClick={() => { run({ kind: 'clear-auth', server: name }) }}>Sign out</button>
      )}
      <button
        type="button"
        className="btn small"
        data-testid="chat-mcp-toggle"
        disabled={busy}
        onClick={() => { run({ kind: 'toggle', server: name, enabled: server.status === 'disabled' }) }}
      >
        {server.status === 'disabled' ? 'Enable' : 'Disable'}
      </button>
    </div>
  )
}

function ServerRow({ sessionId, server, busy }: { sessionId: SessionId; server: McpServer; busy: boolean }): JSX.Element {
  const [showTools, setShowTools] = useState(false)
  const { busyAnimation, busyAnimationColor } = useAppSettings()
  const meta = [server.transport, server.version === null ? '' : `v${server.version}`].filter((m) => m !== '').join(' · ')
  return (
    <li className="chat-mcp-server" data-testid="chat-mcp-server" data-status={server.status} data-name={server.name}>
      <div className="chat-mcp-server-line">
        <span className="chat-mcp-dot" aria-hidden="true" />
        <span className="chat-mcp-name" title={server.name}>{server.name}</span>
        <span className="chat-mcp-status" data-testid="chat-mcp-status">
          {busy ? <BusyGlyph animation={busyAnimation} color={busyAnimationColor} /> : STATUS_LABEL[server.status]}
        </span>
        {meta !== '' && <span className="chat-mcp-meta">{meta}</span>}
        {server.tools.length > 0 && (
          <button
            type="button"
            className="chat-mcp-tools-toggle"
            data-testid="chat-mcp-tools-toggle"
            aria-expanded={showTools}
            onClick={() => { setShowTools(!showTools) }}
          >
            {server.tools.length} {server.tools.length === 1 ? 'tool' : 'tools'}
          </button>
        )}
        <ServerActions sessionId={sessionId} server={server} busy={busy} />
      </div>
      {server.error !== null && <div className="chat-mcp-error" data-testid="chat-mcp-server-error">{server.error}</div>}
      {showTools && (
        <ul className="chat-mcp-tools" data-testid="chat-mcp-tools">
          {server.tools.map((t) => <li key={t} className="chat-mcp-tool">{t}</li>)}
        </ul>
      )}
    </li>
  )
}

/** A sign-in in progress: the page to open, and the way back for a redirect claude cannot hear. */
function SignInNote({ sessionId, signIn }: { sessionId: SessionId; signIn: McpSignIn }): JSX.Element {
  const [pasted, setPasted] = useState('')
  const submit = (): void => {
    const url = pasted.trim()
    if (url === '') return
    void runMcp(sessionId, { kind: 'callback', server: signIn.server, url })
    setPasted('')
  }
  return (
    <div className="chat-mcp-sign-in" data-testid="chat-mcp-sign-in-note">
      <p className="chat-mcp-sign-in-text">
        {signIn.callbackExpected
          ? `Sign in to ${signIn.server} in your browser. When the browser says you are done, this updates by itself.`
          : `Connect ${signIn.server} on claude.ai, then press Reconnect.`}
      </p>
      <a className="btn small primary chat-mcp-sign-in-link" href={signIn.url} target="_blank" rel="noreferrer" data-testid="chat-mcp-sign-in-link">
        Open the sign-in page
      </a>
      {signIn.callbackExpected && (
        <>
        <p className="chat-mcp-paste-hint">Signing in from another computer? If the browser ends on a page that will not load, paste its address here.</p>
        <div className="chat-mcp-paste">
          <input
            className="chat-mcp-paste-input"
            data-testid="chat-mcp-callback"
            value={pasted}
            placeholder="http://localhost:…"
            aria-label="The address the browser ended on"
            onChange={(e) => { setPasted(e.target.value) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          />
          <button type="button" className="btn small" data-testid="chat-mcp-callback-send" disabled={pasted.trim() === ''} onClick={submit}>Finish</button>
        </div>
        </>
      )}
    </div>
  )
}

/**
 * The chat's MCP servers (`/mcp`), as Claude Code's terminal dialog shows them: grouped by where
 * they are configured, each with its status, tools and what can be done with it (sign in or out,
 * reconnect, enable or disable). Escape (inside it) or × puts it away.
 */
export function McpCard({ sessionId }: { sessionId: SessionId }): JSX.Element | null {
  const card = useMcpCard(sessionId)
  const { busyAnimation, busyAnimationColor } = useAppSettings()
  const signIn = card.answer?.signIn ?? null
  const signingIn = card.open && signIn !== null
  // Back from the browser: the sign-in may have finished.
  useEffect(() => {
    if (!signingIn) return undefined
    const onFocus = (): void => { void refreshMcp(sessionId) }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [signingIn, sessionId])

  if (!card.open) return null
  const servers = card.answer?.servers ?? []
  const reading = card.reading
  const summaryText = card.answer === null ? '' : summary(servers)

  return (
    <section
      className="chat-mcp"
      data-testid="chat-mcp"
      aria-label="MCP servers"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMcp(sessionId) } }}
    >
      <header className="chat-aside-head">
        <span className="chat-aside-label">MCP servers</span>
        <span className="chat-aside-hint" data-testid="chat-mcp-summary" title={summaryText}>{summaryText}</span>
        <button
          type="button"
          className="chat-aside-button"
          data-testid="chat-mcp-refresh"
          aria-label="Read the servers again"
          title="Read the servers again"
          disabled={(card.reading || card.working !== null) || card.unavailable !== null}
          onClick={() => { void refreshMcp(sessionId) }}
        >
          <RefreshIcon className={reading ? 'spinner' : undefined} />
        </button>
        <button type="button" className="chat-aside-button" data-testid="chat-mcp-close" aria-label="Close the MCP servers" title="Close (Esc). /mcp opens it again" onClick={() => { closeMcp(sessionId) }}>
          ×
        </button>
      </header>
      <div className="chat-mcp-body">
        {card.unavailable !== null && <p className="chat-aside-empty" data-testid="chat-mcp-unavailable">{card.unavailable}</p>}
        {card.error !== null && <p className="chat-aside-error" role="alert" data-testid="chat-mcp-error">{card.error}</p>}
        {signIn !== null && <SignInNote sessionId={sessionId} signIn={signIn} />}
        {card.answer === null && reading && (
          <span className="chat-aside-asking" role="status"><BusyGlyph animation={busyAnimation} color={busyAnimationColor} />Reading the servers…</span>
        )}
        {card.answer !== null && servers.length === 0 && <p className="chat-aside-empty">No MCP servers are configured for this session.</p>}
        {groups(servers).map(([label, list]) => (
          <section key={label} className="chat-mcp-group" aria-label={label}>
            <h3 className="chat-mcp-group-label">{label}</h3>
            <ul className="chat-mcp-list">
              {list.map((s) => <ServerRow key={s.name} sessionId={sessionId} server={s} busy={card.working === s.name} />)}
            </ul>
          </section>
        ))}
      </div>
      {card.unavailable === null && (
        <footer className="chat-mcp-foot">
          <span>Added a server with <code>claude mcp add</code>? Reload the session to load it.</span>
          <button
            type="button"
            className="btn small"
            data-testid="chat-mcp-reload"
            disabled={(card.reading || card.working !== null)}
            onClick={() => { surface(reloadSession(sessionId, null).then(() => refreshMcp(sessionId)), 'Could not reload this session') }}
          >
            Reload session
          </button>
        </footer>
      )}
    </section>
  )
}
