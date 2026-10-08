import { type JSX, useState, useRef, useEffect } from 'react'
import { PencilIcon, TrashIcon } from '../../ui/icons'
import { Listbox, useListboxNav } from '../../ui/Listbox'
import { useResizeDrag } from '../../ui/useResizeDrag'

interface Tab { id: string; name: string }

interface Props {
  tabs: Tab[]
  activeId: string | null
  onSwitch: (tabId: string) => void
  onRename: (tabId: string, name: string) => void
  onDelete: (tabId: string) => void
  /** Moves a terminal to sit where the one it was dropped on was. */
  onReorder: (tabId: string, beforeId: string) => void
  /** Asks for a terminal to go into rename mode — F2 pressed in the terminal itself. A fresh
   *  object each time, so pressing it twice for the same terminal still counts. */
  renameRequest?: { id: string } | null
  /** Called once a request has been acted on, so a list that is hidden and shown again does not
   *  act on it a second time. */
  onRenameRequestHandled?: () => void
  /** The width the user dragged the list to, or null to fit the longest terminal name. */
  width?: number | null
  /** A drag on the list's edge finished (a width), or it was double-clicked (null: fit again). */
  onResize?: (width: number | null) => void
}

/** Narrowest and widest a dragged list may be; a fitted list is bounded in CSS the same way. */
export const TERMINAL_LIST_MIN = 96
export const TERMINAL_LIST_MAX = 480

/** The side panel listing every open terminal for the current session — click switches; a rename
 *  and a trash button appear on hover (double-clicking the label also renames, for muscle
 *  memory), so with several terminals open there's always a visible way to tidy them up.
 *  Arrow keys navigate the list when focused: ArrowDown moves to the next shell, ArrowUp to the
 *  previous, and switching shells as you navigate (roving-focus listbox pattern). */
export function TerminalListPanel(
  { tabs, activeId, onSwitch, onRename, onDelete, onReorder, renameRequest = null, onRenameRequestHandled, width = null, onResize }: Props,
): JSX.Element {
  /** The width while a drag is under way; committed through onResize when it ends. */
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** Which terminal has keyboard focus. Starts at the active terminal; arrow keys move it. */
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const listRef = useRef<HTMLElement | null>(null)

  const startRename = (tabId: string): void => {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab === undefined) return
    setDraft(tab.name)
    setEditingId(tabId)
  }

  useEffect(() => {
    if (renameRequest === null) return
    startRename(renameRequest.id)
    onRenameRequestHandled?.()
    // Only a new request starts a rename; `tabs` changing under an open editor must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new rename request starts a rename; `tabs` changing must not restart it
  }, [renameRequest])

  const commit = (tabId: string): void => {
    const trimmed = draft.trim()
    setEditingId(null)
    if (trimmed !== '') onRename(tabId, trimmed)
  }

  // Up/Down walk the terminals and switch to each as the focus passes it: the row "focused" is the
  // `aria-activedescendant`, the active terminal is the one shown.
  const current = focusedId ?? activeId
  const arrows = useListboxNav({
    count: tabs.length,
    active: current !== null ? tabs.findIndex((t) => t.id === current) : -1,
    setActive: (index) => {
      const nextId = tabs[index]?.id
      if (nextId === undefined) return
      setFocusedId(nextId)
      onSwitch(nextId)
      // Keyboard focus belongs to the list, not to the row that happened to be clicked first.
      // Left on that row's button, the browser draws its own focus ring around it the moment a
      // key is pressed — a full box around a row, which is exactly what a row here looks like
      // while it is being renamed, and on the wrong row besides, since the arrow has already
      // moved to another one.
      listRef.current?.focus()
    },
  })

  const handleListKeyDown = (e: React.KeyboardEvent): void => {
    if (editingId !== null) return // Don't navigate while renaming

    if (e.key === 'F2') {
      const target = focusedId ?? activeId
      if (target !== null) { e.preventDefault(); startRename(target) }
      return
    }

    arrows.onKeyDown(e)
  }

  const handleItemClick = (tabId: string): void => {
    setFocusedId(tabId)
    onSwitch(tabId)
    listRef.current?.focus()
  }

  const handleListFocus = (): void => {
    // Initialize keyboard focus to the active terminal if nothing is focused yet
    if (focusedId === null && activeId !== null) {
      setFocusedId(activeId)
    }
  }

  const listWidth = (): number => listRef.current?.getBoundingClientRect().width ?? TERMINAL_LIST_MIN
  const { separatorProps } = useResizeDrag({
    axis: 'col',
    value: Math.round(dragWidth ?? width ?? TERMINAL_LIST_MIN),
    min: TERMINAL_LIST_MIN,
    max: TERMINAL_LIST_MAX,
    label: 'Resize the terminal list',
    // The handle is on the list's left edge: dragging (or arrowing) left widens it.
    grows: 'back',
    initial: listWidth,
    measure: (e, start) => Math.round(Math.min(TERMINAL_LIST_MAX, Math.max(TERMINAL_LIST_MIN, start.value + start.x - e.clientX))),
    onLive: setDragWidth,
    onEnd: (w) => {
      setDragWidth(null)
      onResize?.(w)
    },
  })

  const shown = dragWidth ?? width
  return (
    <>
    <div
      className="terminal-list-resizer"
      data-testid="terminal-list-resizer"
      title="Drag to resize · double-click to fit the names"
      {...separatorProps}
      onDoubleClick={() => { onResize?.(null) }}
    />
    <Listbox
      as="ul"
      ref={listRef}
      className="terminal-list-panel"
      testId="terminal-list-panel"
      label="Open terminals"
      tabIndex={0}
      // The focused row is named rather than focused in the DOM (the roving-focus listbox
      // pattern), so assistive technology follows the arrow keys without focus leaving the list.
      activeId={focusedId === null ? undefined : `terminal-tab-${focusedId}`}
      onKeyDown={handleListKeyDown}
      onFocus={handleListFocus}
      // Unset, the list is as wide as its longest name (bounded in styles.css).
      style={shown === null ? undefined : { width: shown }}
      data-fitted={shown === null}
    >
      {tabs.map((tab) => (
        <li
          key={tab.id}
          id={`terminal-tab-${tab.id}`}
          className="terminal-tab-row"
          data-testid="terminal-tab-row"
          data-active={tab.id === activeId}
          data-keyboard-focused={tab.id === focusedId}
          role="option"
          aria-selected={tab.id === activeId}
          // Not draggable while being renamed: the input inside needs its own text selection and
          // caret, both of which a drag would hijack.
          draggable={editingId !== tab.id}
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
                // Stopped rather than left to bubble: this panel can be showing while a dialog or
                // menu is open on the shared Escape stack (UI-13), and Escape here should cancel
                // just the rename, not also close that layer.
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingId(null) }
              }}
            />
          ) : (
            <button
              className="terminal-tab-label"
              data-testid="terminal-tab-label"
              onClick={() => handleItemClick(tab.id)}
              onDoubleClick={() => { startRename(tab.id) }}
            >
              {tab.name}
            </button>
          )}
          {/* Floated over the end of the row on hover rather than laid out beside the label, so a
              list sized to its longest name does not jump wider under the pointer. */}
          <span className="terminal-tab-actions">
          {editingId !== tab.id && (
            // A dedicated button, not just the label's double-click: with many terminals open and
            // no other way to tell, double-click-to-rename is easy to never discover at all.
            <button
              className="terminal-tab-action terminal-tab-rename"
              data-testid="terminal-tab-rename"
              title="Rename terminal (F2)"
              aria-label={`Rename ${tab.name}`}
              onClick={() => { startRename(tab.id) }}
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
          </span>
        </li>
      ))}
    </Listbox>
    </>
  )
}
