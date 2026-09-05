import { useState } from 'react'
import { TrashIcon } from './icons'

interface Tab { id: string; name: string }

interface Props {
  tabs: Tab[]
  activeId: string | null
  onSwitch: (tabId: string) => void
  onRename: (tabId: string, name: string) => void
  onDelete: (tabId: string) => void
}

/** The side panel listing every open terminal for the current session — click switches,
 *  double-click the label renames in place, the trash icon deletes. */
export function TerminalListPanel({ tabs, activeId, onSwitch, onRename, onDelete }: Props): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commit = (tabId: string): void => {
    const trimmed = draft.trim()
    setEditingId(null)
    if (trimmed !== '') onRename(tabId, trimmed)
  }

  return (
    <ul className="terminal-list-panel" data-testid="terminal-list-panel">
      {tabs.map((tab) => (
        <li
          key={tab.id}
          className="terminal-tab-row"
          data-testid="terminal-tab-row"
          data-active={tab.id === activeId}
        >
          {editingId === tab.id ? (
            <input
              className="terminal-tab-rename-input"
              data-testid="terminal-tab-rename-input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(tab.id) }
                if (e.key === 'Escape') { e.preventDefault(); setEditingId(null) }
              }}
            />
          ) : (
            <button
              className="terminal-tab-label"
              data-testid="terminal-tab-label"
              onClick={() => onSwitch(tab.id)}
              onDoubleClick={() => { setDraft(tab.name); setEditingId(tab.id) }}
            >
              {tab.name}
            </button>
          )}
          <button
            className="terminal-tab-delete"
            data-testid="terminal-tab-delete"
            title="Close terminal"
            aria-label="Close terminal"
            onClick={() => onDelete(tab.id)}
          >
            <TrashIcon />
          </button>
        </li>
      ))}
    </ul>
  )
}
