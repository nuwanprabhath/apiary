import type { JSX } from 'react'
import { CHAT_PERMISSION_MODES, CHAT_PERMISSION_MODE_LABELS, type ChatPermissionMode } from '@shared/domain/chat'
import { BoltIcon, CheckIcon, CodeBracketsIcon, HandIcon, ScrollIcon } from '../../ui/icons'
import { Menu } from '../../ui/Menu'
import { usePopover } from './usePopover'

const DESCRIPTIONS: Record<ChatPermissionMode, string> = {
  manual: 'Claude will ask for approval before making each edit',
  acceptEdits: 'Claude will make edits without asking first',
  plan: 'Claude will explore the code and present a plan before editing',
  auto: 'Claude will approve actions that pass a safety check and pause for anything risky',
}

/** The menu order the extension uses; `CHAT_PERMISSION_MODES` keeps its own for the protocol. */
const ORDER: readonly ChatPermissionMode[] = ['manual', 'acceptEdits', 'plan', 'auto']

function ModeIcon({ mode }: { mode: ChatPermissionMode | '' }): JSX.Element {
  switch (mode) {
    case 'manual': return <HandIcon />
    case 'acceptEdits': return <CodeBracketsIcon />
    case 'plan': return <ScrollIcon />
    case 'auto':
    case '': return <BoltIcon />
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
        <Menu className="chat-menu chat-mode-menu" testId="composer-mode-menu">
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
        </Menu>
      )}
    </div>
  )
}
