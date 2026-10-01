import type { JSX } from 'react'
import { CHAT_PERMISSION_MODES, CHAT_PERMISSION_MODE_LABELS, type ChatPermissionMode } from '@shared/domain/chat'
import { CheckIcon } from '../../ui/icons'
import { usePopover } from './usePopover'

const DESCRIPTIONS: Record<ChatPermissionMode, string> = {
  manual: 'Claude will ask for approval before making each edit',
  acceptEdits: 'Claude will make edits without asking first',
  plan: 'Claude will explore the code and present a plan before editing',
  auto: 'Claude will approve actions that pass a safety check and pause for anything risky',
}

/** The menu order the extension uses; `CHAT_PERMISSION_MODES` keeps its own for the protocol. */
const ORDER: readonly ChatPermissionMode[] = ['manual', 'acceptEdits', 'plan', 'auto']

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function ModeIcon({ mode }: { mode: ChatPermissionMode | '' }): JSX.Element {
  switch (mode) {
    case 'manual': // a raised hand: Claude stops and asks
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
          <path d="M5 8V3.5a1 1 0 0 1 2 0V7M7 7V2.5a1 1 0 0 1 2 0V7M9 7V3.5a1 1 0 0 1 2 0V8M11 8V5.5a1 1 0 0 1 2 0v4A4.5 4.5 0 0 1 8.5 14h-.7a4 4 0 0 1-3.2-1.6L2.6 9.8a1 1 0 0 1 1.5-1.3L5 9.5" />
        </svg>
      )
    case 'acceptEdits': // code brackets: edits go straight in
      return <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke}><path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9 3 7 13" /></svg>
    case 'plan': // a scroll: a plan to read first
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
          <path d="M4 3h8.5a1.5 1.5 0 0 1 0 3H12v6.5A1.5 1.5 0 0 1 10.5 14H3.5A1.5 1.5 0 0 1 2 12.5V12h8M4 3a1.5 1.5 0 0 0-1.5 1.5V12M6 7h4M6 9.5h3" />
        </svg>
      )
    case 'auto':
    case '': // a bolt: Auto, and the starting default (Claude's own choice, Auto in current versions)
      return <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke}><path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" /></svg>
  }
}

/**
 * The permission mode, as the extension's message box shows it: a button with the mode's icon and
 * name, opening a menu that says what each mode does.
 */
export function ModeMenu({ mode, onMode }: { mode: ChatPermissionMode | ''; onMode: (mode: ChatPermissionMode) => void }): JSX.Element {
  const { open, setOpen, root } = usePopover()
  return (
    <div className="chat-mode" ref={root}>
      <button
        type="button"
        className="chat-mode-button"
        data-testid="composer-mode"
        data-mode={mode}
        aria-haspopup="menu"
        aria-expanded={open}
        title="How much Claude asks before it acts"
        onClick={() => { setOpen(!open) }}
      >
        <ModeIcon mode={mode} />
        <span>{mode === '' ? 'Default' : CHAT_PERMISSION_MODE_LABELS[mode]}</span>
      </button>
      {open && (
        <div className="chat-menu chat-mode-menu" role="menu" data-testid="composer-mode-menu">
          <div className="chat-menu-heading">Modes</div>
          {ORDER.filter((m) => CHAT_PERMISSION_MODES.includes(m)).map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={m === mode}
              className="chat-menu-option"
              data-testid={`composer-mode-${m}`}
              onClick={() => { onMode(m); setOpen(false) }}
            >
              <span className="chat-menu-icon"><ModeIcon mode={m} /></span>
              <span className="chat-menu-option-text">
                <span className="chat-menu-option-name">{CHAT_PERMISSION_MODE_LABELS[m]}</span>
                <span className="chat-menu-option-desc">{DESCRIPTIONS[m]}</span>
              </span>
              {m === mode && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
