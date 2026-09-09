import { useState } from 'react'
import { PencilIcon, TrashIcon } from './icons'

interface Tab { id: string; name: string }

interface Props {
  tabs: Tab[]
  activeId: string | null
  onSwitch: (tabId: string) => void
  onRename: (tabId: string, name: string) => void
  onDelete: (tabId: string) => void
}

/** The side panel listing every open terminal for the current session — click switches; a rename
 *  and a trash button appear on hover (double-clicking the label also renames, for muscle
 *  memory), so with several terminals open there's always a visible way to tidy them up. */
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
          {editingId !== tab.id && (
            // A dedicated button, not just the label's double-click: with many terminals open and
            // no other way to tell, double-click-to-rename is easy to never discover at all.
            <button
              className="terminal-tab-action terminal-tab-rename"
              data-testid="terminal-tab-rename"
              title="Rename terminal"
              aria-label={`Rename ${tab.name}`}
              onClick={() => { setDraft(tab.name); setEditingId(tab.id) }}
            >
              <PencilIcon />
            </button>
          )}
          <button
            className="terminal-tab-action terminal-tab-delete"
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
