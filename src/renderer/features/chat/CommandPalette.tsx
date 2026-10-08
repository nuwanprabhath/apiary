import { type JSX, useId, useMemo, useState } from 'react'
import type { ChatCommand } from '@shared/domain/chat'
import { fuzzyScore } from '@shared/fuzzy'
import { SlashBoxIcon } from '../../ui/icons'
import { Listbox, optionId, useListboxNav } from '../../ui/Listbox'
import { Popover } from '../../ui/Popover'
import { usePopover } from './usePopover'

/** More than this and the list is a scroll of things nobody is looking for. */
const MAX_SHOWN = 60

/** Commands matching `query`: by name first (fuzzy), then anything whose description says it. */
export function matchCommands(commands: readonly ChatCommand[], query: string): ChatCommand[] {
  const q = query.trim().replace(/^\//, '')
  if (q === '') return commands.slice(0, MAX_SHOWN)
  const scored = commands.flatMap((c) => {
    const byName = fuzzyScore(q, c.name)
    if (byName !== null) return [{ c, score: 1000 + byName }]
    return c.description.toLowerCase().includes(q.toLowerCase()) ? [{ c, score: 0 }] : []
  })
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_SHOWN).map((s) => s.c)
}

interface Props {
  /** claude's own commands, or null before the chat has started (it is what lists them). */
  commands: readonly ChatCommand[] | null
  /** Runs a command that takes nothing. */
  onRun: (command: string) => void
  /** Puts a command that takes arguments into the message box, for them to be typed after it. */
  onInsert: (command: string) => void
}

/**
 * The "/" button: Claude's slash commands — built-in ones like `/compact` and `/context`, and your
 * skills and plugin commands — searchable, as the extension's command menu is. A command that takes
 * nothing runs at once; one that takes arguments goes into the message box to finish typing.
 */
export function CommandPalette({ commands, onRun, onInsert }: Props): JSX.Element {
  const { open, setOpen, root } = usePopover()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const shown = useMemo(() => matchCommands(commands ?? [], query), [commands, query])

  const choose = (c: ChatCommand): void => {
    setOpen(false)
    setQuery('')
    if (c.argumentHint !== '') onInsert(`/${c.name} `)
    else onRun(`/${c.name}`)
  }

  const { onKeyDown } = useListboxNav({
    count: shown.length,
    active,
    setActive,
    onChoose: () => {
      const picked = shown[active]
      if (picked !== undefined) choose(picked)
      // Nothing listed (the chat has not started yet): what was typed is the command.
      else if (query.trim() !== '') { setOpen(false); onRun(`/${query.trim().replace(/^\//, '')}`); setQuery('') }
    },
  })

  return (
    <div className="chat-commands" ref={root}>
      <button
        type="button"
        className="chat-icon-button"
        data-testid="composer-commands"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Slash commands"
        onClick={() => { setOpen(!open); setActive(0) }}
      >
        <SlashBoxIcon />
      </button>
      {open && (
        <Popover className="chat-menu chat-command-menu" label="Slash commands" testId="composer-command-menu">
          <input
            className="chat-command-search"
            data-testid="composer-command-search"
            autoFocus
            placeholder="Search commands"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[active] === undefined ? undefined : optionId(listId, active)}
          />
          <div className="chat-menu-heading">Slash commands</div>
          <Listbox id={listId} label="Slash commands" className="chat-command-list">
            {commands === null && (
              <p className="chat-command-empty">
                Claude lists its commands once the chat has started. Type one and press Enter to run it.
              </p>
            )}
            {commands !== null && shown.length === 0 && <p className="chat-command-empty">No matching commands</p>}
            {shown.map((c, i) => (
              <button
                key={c.name}
                id={optionId(listId, i)}
                type="button"
                role="option"
                aria-selected={i === active}
                className="chat-command-option"
                data-testid="composer-command-option"
                data-name={c.name}
                title={c.description}
                onMouseEnter={() => { setActive(i) }}
                onClick={() => { choose(c) }}
              >
                <span className="chat-command-name">/{c.name}</span>
                {c.argumentHint !== '' && <span className="chat-command-hint">{c.argumentHint}</span>}
                <span className="chat-command-desc">{c.description}</span>
              </button>
            ))}
          </Listbox>
        </Popover>
      )}
    </div>
  )
}
