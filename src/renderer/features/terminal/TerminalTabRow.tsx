import { type JSX } from 'react'
import { PencilIcon, TrashIcon } from '../../ui/icons'
import { focusAskedFor } from '../../ui/focusUnlessTyping'

interface Props {
  tab: { id: string; name: string }
  active: boolean
  keyboardFocused: boolean
  /** The row is being renamed: its label is an input holding `draft`. */
  editing: boolean
  draft: string
  onDraft: (draft: string) => void
  onCommit: () => void
  onCancel: () => void
  onClick: () => void
  onRename: () => void
  onDelete: () => void
  /** Moves the dragged terminal to sit where this one is. */
  onReorder: (tabId: string, beforeId: string) => void
}

/** One row of the terminal list: its label (an input while renamed) and the rename and close
 *  buttons floated over its end. */
export function TerminalTabRow(
  { tab, active, keyboardFocused, editing, draft, onDraft, onCommit, onCancel, onClick, onRename, onDelete, onReorder }: Props,
): JSX.Element {
  return (
    <li
      id={`terminal-tab-${tab.id}`}
      className="terminal-tab-row"
      data-testid="terminal-tab-row"
      data-active={active}
      data-keyboard-focused={keyboardFocused}
      role="option"
      aria-selected={active}
      // Not draggable while being renamed: the input inside needs its own text selection and
      // caret, both of which a drag would hijack.
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-apiary-terminal', tab.id)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-apiary-terminal')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        const dragged = e.dataTransfer.getData('application/x-apiary-terminal')
        if (dragged === '' || dragged === tab.id) return
        e.preventDefault()
        onReorder(dragged, tab.id)
      }}
    >
      {editing ? (
        <>
        {/* The name, unseen, keeps the row as wide as it was: the field sits over it rather than
            sizing the row, as an input's default width of about 20 characters widened a list fitted
            to its names the moment a rename began. */}
        <span className="terminal-tab-label terminal-tab-label-sizer" aria-hidden="true">{tab.name}</span>
        <input
          ref={focusAskedFor}
          className="terminal-tab-rename-input"
          data-testid="terminal-tab-rename-input"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onCommit() }
            // Stopped rather than left to bubble: this panel can be showing while a dialog or
            // menu is open on the shared Escape stack, and Escape here should cancel
            // just the rename, not also close that layer.
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
          }}
        />
        </>
      ) : (
        <button
          className="terminal-tab-label"
          data-testid="terminal-tab-label"
          onClick={onClick}
          onDoubleClick={onRename}
        >
          {tab.name}
        </button>
      )}
      {/* Floated over the end of the row on hover rather than laid out beside the label, so a
          list sized to its longest name does not jump wider under the pointer. */}
      <span className="terminal-tab-actions">
        {!editing && (
          // A dedicated button, not just the label's double-click: with many terminals open and
          // no other way to tell, double-click-to-rename is easy to never discover at all.
          <button
            className="terminal-tab-action terminal-tab-rename"
            data-testid="terminal-tab-rename"
            title="Rename terminal (F2)"
            aria-label={`Rename ${tab.name}`}
            onClick={onRename}
          >
            <PencilIcon />
          </button>
        )}
        <button
          className="terminal-tab-action terminal-tab-delete"
          data-testid="terminal-tab-delete"
          title="Close terminal"
          aria-label="Close terminal"
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      </span>
    </li>
  )
}
