import { useState, useRef } from 'react'
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
 *  memory), so with several terminals open there's always a visible way to tidy them up.
 *  Arrow keys navigate the list when focused: ArrowDown moves to the next shell, ArrowUp to the
 *  previous, and switching shells as you navigate (roving-focus listbox pattern). */
export function TerminalListPanel({ tabs, activeId, onSwitch, onRename, onDelete }: Props): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** Which terminal has keyboard focus. Starts at the active terminal; arrow keys move it. */
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const commit = (tabId: string): void => {
    const trimmed = draft.trim()
    setEditingId(null)
    if (trimmed !== '') onRename(tabId, trimmed)
  }

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>): void => {
    if (editingId !== null) return // Don't navigate while renaming

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()

      // Find the index of the currently focused item (or the active one if nothing is focused yet)
      const current = focusedId ?? activeId
      const currentIdx = current !== null ? tabs.findIndex(t => t.id === current) : -1

      let nextIdx = currentIdx
      if (e.key === 'ArrowDown') {
        nextIdx = Math.min(currentIdx + 1, tabs.length - 1)
      } else {
        nextIdx = Math.max(currentIdx - 1, 0)
      }

      const nextId = tabs[nextIdx]?.id
      if (nextId) {
        setFocusedId(nextId)
        onSwitch(nextId)
      }
    }
  }

  const handleItemClick = (tabId: string): void => {
    setFocusedId(tabId)
    onSwitch(tabId)
  }

  const handleListFocus = (): void => {
    // Initialize keyboard focus to the active terminal if nothing is focused yet
    if (focusedId === null && activeId !== null) {
      setFocusedId(activeId)
    }
  }

  return (
    <ul
      ref={listRef}
      className="terminal-list-panel"
      data-testid="terminal-list-panel"
      role="listbox"
      aria-label="Open terminals"
      tabIndex={0}
      onKeyDown={handleListKeyDown}
      onFocus={handleListFocus}
    >
      {tabs.map((tab) => (
        <li
          key={tab.id}
          className="terminal-tab-row"
          data-testid="terminal-tab-row"
          data-active={tab.id === activeId}
          data-keyboard-focused={tab.id === focusedId}
          role="option"
          aria-selected={tab.id === activeId}
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
              onClick={() => handleItemClick(tab.id)}
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
