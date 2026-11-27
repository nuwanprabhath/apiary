import type { JSX } from 'react'
import { useTerminalNotice } from '../../state/activeTabsStore'

/**
 * The note Claude Code is showing in the session's terminal ("Heads up · …"), which reaches the
 * chat no other way. Its answers are keys pressed in the terminal, so the card names them and
 * offers the way there rather than typing into a box that may hold the person's half-written text.
 */
export function TerminalNoticeCard({ tabKey, onShowTerminal }: { tabKey: string; onShowTerminal: () => void }): JSX.Element | null {
  const notice = useTerminalNotice(tabKey)
  if (notice === null) return null
  return (
    <div className="chat-terminal-notice" data-testid="chat-terminal-notice" role="note">
      <p className="chat-terminal-notice-text">
        <span className="chat-terminal-notice-tag">{notice.tag}</span>
        {' · '}
        {notice.text}
      </p>
      <div className="chat-terminal-notice-foot">
        {notice.choices.length > 0 && (
          <span className="muted chat-terminal-notice-choices" data-testid="chat-terminal-notice-choices">
            {notice.choices.map((c) => `${c.key}: ${c.label}`).join('   ')}
          </span>
        )}
        <button type="button" className="btn small" data-testid="chat-terminal-notice-open" onClick={onShowTerminal}>
          Answer in the terminal
        </button>
      </div>
    </div>
  )
}
