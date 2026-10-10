import { type JSX, type KeyboardEvent, type RefObject, useEffect, useId, useMemo, useState } from 'react'
import type { ChatCommand } from '@shared/domain/chat'
import type { SessionId } from '@shared/domain/ids'
import { fuzzyScore } from '@shared/fuzzy'
import { SlashBoxIcon } from '../../ui/icons'
import { Listbox, optionId, useListboxNav } from '../../ui/Listbox'
import { Popover } from '../../ui/Popover'
import { Switch } from '../../ui/Switch'
import { usePopover } from './usePopover'
import { useChatSettings } from '../../state/chatSettingsStore'
import { useAppSettings } from '../../state/settingsStore'
import { CHAT_SETTINGS_REGISTRY, chatSettingRows, chatSettingValue, type ChatSetting } from '../../state/chatSettings'

/** More than this and the list is a scroll of things nobody is looking for. */
const MAX_SHOWN = 60

/** The message box holds only a slash and a command word: the "/" menu is open for it. */
const TYPED_SLASH = /^\/\S*$/

interface ActionItem {
  kind: 'command'
  command: ChatCommand
  score?: number
}

interface SettingItem {
  kind: 'setting'
  settingId: string
  label: string
  value: boolean
  score?: number
}

type Action = ActionItem | SettingItem

function matchActions(commands: readonly ChatCommand[], query: string): Action[] {
  const q = query.trim().replace(/^\//, '')
  const scored = commands.flatMap((c) => {
    const byName = fuzzyScore(q, c.name)
    if (byName !== null) return [{ c, score: 1000 + byName }]
    return c.description.toLowerCase().includes(q.toLowerCase()) ? [{ c, score: 0 }] : []
  })
  return scored.sort((a, b) => b.score - a.score).map((s) => ({ kind: 'command' as const, command: s.c, score: s.score }))
}

interface Props {
  sessionId: SessionId | null
  commands: readonly ChatCommand[] | null
  /** What is in the message box: typing "/" at its start opens this same menu. */
  composerText: string
  /** The message box hands its Up/Down/Enter/Escape here first; true means the menu used the key. */
  keyHandler: RefObject<((e: KeyboardEvent) => boolean) | null>
  onRun: (command: string) => void
  onInsert: (command: string) => void
}

function Row({ id, selected, testId, extra, title, onEnter, onClick, children }: {
  id: string
  selected: boolean
  testId: string
  extra: Record<string, string>
  title?: string
  onEnter: () => void
  onClick: () => void
  children: JSX.Element[]
}): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      className="chat-command-option"
      data-testid={testId}
      title={title}
      onMouseEnter={onEnter}
      onClick={onClick}
      ref={(el) => { if (selected) el?.scrollIntoView?.({ block: 'nearest' }) }}
      {...extra}
    >
      {children}
    </button>
  )
}

function ActionsList({ shown, active, listId, onMouseEnter, onChoose }: {
  shown: Action[]
  active: number
  listId: string
  onMouseEnter: (i: number) => void
  onChoose: (a: Action) => void
}): JSX.Element {
  const settingItems = shown.filter((a) => a.kind === 'setting')
  const commandItems = shown.filter((a) => a.kind === 'command')

  return (
    <Listbox id={listId} label="Actions" className="chat-command-list">
      {settingItems.length > 0 && <div className="chat-menu-heading" role="presentation">Chat settings</div>}
      <div className="chat-command-group" role="presentation">
      {settingItems.map((a) => {
        const idx = shown.indexOf(a)
        return (
          <Row
            key={a.settingId}
            id={optionId(listId, idx)}
            selected={idx === active}
            testId="composer-setting-option"
            extra={{ 'data-setting': a.settingId, 'aria-checked': String(a.value) }}
            onEnter={() => { onMouseEnter(idx) }}
            onClick={() => { onChoose(a) }}
          >
            {[
              <span key="n" className="chat-command-name" title={a.label}>{a.label}</span>,
              <span key="v" className="chat-setting-switch"><Switch checked={a.value} /></span>,
            ]}
          </Row>
        )
      })}
      </div>
      {commandItems.length > 0 && <div className="chat-menu-heading" role="presentation">Commands</div>}
      <div className="chat-command-group" role="presentation">
      {commandItems.map((a) => {
        const c = a.command
        const idx = shown.indexOf(a)
        return (
          <Row
            key={c.name}
            id={optionId(listId, idx)}
            selected={idx === active}
            testId="composer-command-option"
            extra={{ 'data-name': c.name }}
            title={c.description}
            onEnter={() => { onMouseEnter(idx) }}
            onClick={() => { onChoose(a) }}
          >
            {[
              <span key="n" className="chat-command-name" title={'/' + c.name}>/{c.name}</span>,
              <span key="d" className="chat-command-desc">{c.description}</span>,
            ]}
          </Row>
        )
      })}
      </div>
    </Listbox>
  )
}

function footerText(a: Action | undefined): string {
  if (a === undefined) return ''
  if (a.kind === 'setting') return `${a.label}: ${a.value ? 'On' : 'Off'} — this chat only`
  const c = a.command
  return [`/${c.name}`, c.argumentHint, c.description !== '' ? `— ${c.description}` : ''].filter((p) => p !== '').join(' ')
}

export function CommandPalette({ sessionId, commands, composerText, keyHandler, onRun, onInsert }: Props): JSX.Element {
  const { open: buttonOpen, setOpen: setButtonOpen, root } = usePopover()
  const [buttonQuery, setButtonQuery] = useState('')
  const [active, setActive] = useState(0)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const listId = useId()
  const { hideToolCallIo: globalHideToolCalls } = useAppSettings()
  const { values: perChatSettings, set: setPerChatSetting } = useChatSettings(sessionId)

  const typed = !buttonOpen && TYPED_SLASH.test(composerText) && dismissedFor !== composerText
  const open = buttonOpen || typed
  const query = typed ? composerText.slice(1) : buttonQuery

  useEffect(() => { setActive(0) }, [query])
  useEffect(() => { if (!TYPED_SLASH.test(composerText)) setDismissedFor(null) }, [composerText])

  const shown = useMemo(() => {
    const q = query.trim().replace(/^\//, '')
    const read = (setting: ChatSetting): boolean => chatSettingValue(setting, perChatSettings, { hideToolCallIo: globalHideToolCalls })
    const settings: Action[] = chatSettingRows(CHAT_SETTINGS_REGISTRY, q, read)
      .map(({ setting, value }) => ({ kind: 'setting', settingId: setting.id, label: setting.label, value }))
    return [...settings, ...matchActions(commands ?? [], query)].slice(0, MAX_SHOWN)
  }, [commands, query, perChatSettings, globalHideToolCalls])

  const close = (): void => {
    setButtonOpen(false)
    setButtonQuery('')
    if (typed) setDismissedFor(composerText)
  }

  const choose = (action: Action): void => {
    if (action.kind === 'command') {
      const c = action.command
      close()
      if (c.argumentHint !== '') onInsert(`/${c.name} `)
      else onRun(`/${c.name}`)
    } else {
      setPerChatSetting(action.settingId, !action.value)
    }
  }

  const { onKeyDown } = useListboxNav({
    count: shown.length,
    active,
    setActive,
    onChoose: () => {
      const picked = shown[active]
      if (picked !== undefined) choose(picked)
      else if (query.trim() !== '') { close(); onRun(`/${query.trim().replace(/^\//, '')}`) }
    },
  })

  // In the message box, keys the menu does not use (and Enter with nothing to pick) stay the box's.
  keyHandler.current = typed
    ? (e) => {
        if (e.key === 'Escape') { setDismissedFor(composerText); return true }
        if (e.key === 'Enter' && shown.length === 0) return false
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter') return false
        onKeyDown(e)
        return true
      }
    : null

  const footer = footerText(shown[active])

  return (
    <div className="chat-commands" ref={root}>
      <button
        type="button"
        className="chat-icon-button"
        data-testid="composer-commands"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Actions and settings"
        onClick={() => {
          if (typed) setDismissedFor(composerText)
          else setButtonOpen(!buttonOpen)
          setActive(0)
        }}
      >
        <SlashBoxIcon />
      </button>
      {open && (
        <Popover className="chat-menu chat-command-menu" label="Actions" testId="composer-command-menu" restoreFocus={!typed}>
          <input
            className="chat-command-search"
            data-testid="composer-command-search"
            autoFocus={!typed}
            tabIndex={typed ? -1 : 0}
            readOnly={typed}
            placeholder="Filter actions…"
            value={query}
            onChange={(e) => { setButtonQuery(e.target.value) }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[active] === undefined ? undefined : optionId(listId, active)}
          />
          {shown.length > 0 && <ActionsList shown={shown} active={active} listId={listId} onMouseEnter={setActive} onChoose={choose} />}
          {commands !== null && shown.length === 0 && <p className="chat-command-empty">No matching actions</p>}
          {commands === null && shown.length === 0 && (
            <p className="chat-command-empty">
              Claude lists its commands once the chat has started. Type one and press Enter to run it.
            </p>
          )}
          {footer !== '' && <div className="chat-command-footer" data-testid="composer-command-footer">{footer}</div>}
        </Popover>
      )}
    </div>
  )
}
