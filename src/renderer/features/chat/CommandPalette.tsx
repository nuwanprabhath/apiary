import { type JSX, type KeyboardEvent, type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { focusUnlessTyping } from '../../ui/focusUnlessTyping'
import type { ChatCommand } from '@shared/domain/chat'
import type { SessionId } from '@shared/domain/ids'
import { fuzzyScore } from '@shared/fuzzy'
import { SlashBoxIcon } from '../../ui/icons'
import { Listbox, optionId, useListboxNav } from '../../ui/Listbox'
import { Popover } from '../../ui/Popover'
import { Switch } from '../../ui/Switch'
import { usePopover } from './usePopover'
import { useChatSettings } from '../../state/chatSettingsStore'
import { useLibraryState } from '../../state/libraryStateStore'
import { useVsCodeAvailable } from '../../state/vsCodeStore'
import { AccountOptions } from './AccountOptions'
import { type AccountList, useAccountList } from './useAccountList'
import { PALETTE_ACTIONS, paletteActionRows, type PaletteAction, type PaletteContext } from './paletteActions'
import { Row } from './PaletteRow'
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

interface RegistryItem {
  kind: 'action'
  action: PaletteAction
  label: string
  description: string
}

type Action = ActionItem | SettingItem | RegistryItem

/** Commands Apiary answers itself, offered beside Claude's own: Claude Code's `/btw` is not
 *  available in a chat's stream-json mode, so the message box answers it (`state/chatAside.ts`). */
const APIARY_COMMANDS: readonly ChatCommand[] = [
  { name: 'btw', description: 'Ask a side question without interrupting Claude', argumentHint: '<question>' },
]
/** Chosen from the menu, these run as they are rather than waiting for their argument: `/btw` opens
 *  the side thread, whose own box takes the question. */
const RUNS_BARE: ReadonlySet<string> = new Set(['btw'])

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
  /** The session's folder is on disk: "Open in VS Code" needs it. */
  folderExists: boolean
  /** Puts the cursor back in the message box. */
  onFocusBox: () => void
  /** What is in the message box: typing "/" at its start opens this same menu. */
  composerText: string
  /** The message box hands its Up/Down/Enter/Escape here first; true means the menu used the key. */
  keyHandler: RefObject<((e: KeyboardEvent) => boolean) | null>
  onRun: (command: string) => void
  onInsert: (command: string) => void
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
  const registryItems = shown.filter((a) => a.kind === 'action')

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
      {registryItems.length > 0 && <div className="chat-menu-heading" role="presentation">Actions</div>}
      <div className="chat-command-group" role="presentation">
      {registryItems.map((a) => {
        const idx = shown.indexOf(a)
        return (
          <Row
            key={a.action.id}
            id={optionId(listId, idx)}
            selected={idx === active}
            testId="composer-action-option"
            extra={{ 'data-action': a.action.id }}
            onEnter={() => { onMouseEnter(idx) }}
            onClick={() => { onChoose(a) }}
          >
            {[
              <span key="n" className="chat-command-name" title={a.label}>{a.label}</span>,
              <span key="d" className="chat-command-desc">{a.description}</span>,
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
  if (a.kind === 'action') return a.description
  if (a.kind === 'setting') return `${a.label}: ${a.value ? 'On' : 'Off'} — this chat only`
  const c = a.command
  return [`/${c.name}`, c.argumentHint, c.description !== '' ? `— ${c.description}` : ''].filter((p) => p !== '').join(' ')
}

function EmptyNote({ started }: { started: boolean }): JSX.Element {
  return (
    <p className="chat-command-empty">
      {started ? 'No matching actions' : 'Claude lists its commands once the chat has started. Type one and press Enter to run it.'}
    </p>
  )
}

/** The rows the full list shows for what is typed: chat settings, then actions, then commands. */
function useShownRows({ sessionId, commands, query, folderExists, accountList }: {
  sessionId: SessionId | null
  commands: readonly ChatCommand[] | null
  query: string
  folderExists: boolean
  accountList: AccountList
}): { shown: Action[]; ctx: PaletteContext | null } {
  const { hideToolCallIo: globalHideToolCalls } = useLibraryState()
  const vsCodeAvailable = useVsCodeAvailable()
  const { values: perChatSettings } = useChatSettings(sessionId)
  const { accounts, account } = accountList
  return useMemo(() => {
    const q = query.trim().replace(/^\//, '')
    const read = (setting: ChatSetting): boolean => chatSettingValue(setting, perChatSettings, { hideToolCallIo: globalHideToolCalls })
    const settings: Action[] = chatSettingRows(CHAT_SETTINGS_REGISTRY, q, read)
      .map(({ setting, value }) => ({ kind: 'setting', settingId: setting.id, label: setting.label, value }))
    const ctx = sessionId === null ? null : { sessionId, vsCodeAvailable, folderExists, accounts, account }
    const actions: Action[] = ctx === null ? [] : paletteActionRows(PALETTE_ACTIONS, q, ctx)
      .map((action) => ({ kind: 'action', action, label: action.label(ctx), description: action.description(ctx) }))
    return { shown: [...settings, ...actions, ...matchActions([...(commands ?? []), ...APIARY_COMMANDS], query)].slice(0, MAX_SHOWN), ctx }
  }, [commands, query, perChatSettings, globalHideToolCalls, sessionId, vsCodeAvailable, folderExists, accounts, account])
}

export function CommandPalette({ sessionId, commands, folderExists, onFocusBox, composerText, keyHandler, onRun, onInsert }: Props): JSX.Element {
  const { open: buttonOpen, setOpen: setButtonOpen, root } = usePopover()
  const [buttonQuery, setButtonQuery] = useState('')
  const [active, setActive] = useState(0)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const listId = useId()
  const { set: setPerChatSetting } = useChatSettings(sessionId)

  const typed = !buttonOpen && TYPED_SLASH.test(composerText) && dismissedFor !== composerText
  const open = buttonOpen || typed
  const query = typed ? composerText.slice(1) : buttonQuery

  useEffect(() => { setActive(0) }, [query])
  useEffect(() => { if (!TYPED_SLASH.test(composerText)) setDismissedFor(null) }, [composerText])

  const close = (): void => {
    setButtonOpen(false)
    setButtonQuery('')
    if (typed) setDismissedFor(composerText)
  }
  const accountList = useAccountList({ sessionId, menuOpen: open, setActive, close, onFocusBox })
  const { accounts } = accountList

  const { shown, ctx } = useShownRows({ sessionId, commands, query, folderExists, accountList })

  const choose = (action: Action): void => {
    if (action.kind === 'action' && action.action.opensList === true) accountList.open()
    else if (action.kind === 'action') {
      close()
      if (ctx !== null) action.action.run(ctx)
      onFocusBox()
    } else if (action.kind === 'command') {
      const c = action.command
      close()
      if (c.argumentHint !== '' && !RUNS_BARE.has(c.name)) onInsert(`/${c.name} `)
      else onRun(`/${c.name}`)
    } else {
      setPerChatSetting(action.settingId, !action.value)
    }
  }

  // The search box takes focus as it opens, unless the menu was opened from the message box (the
  // person is typing there) or a text field has focus for another reason. Stable, so only the
  // mount focuses: `typed` is read as it was when the box appeared.
  const typedRef = useRef(typed)
  typedRef.current = typed
  const focusSearchOnMount = useCallback((el: HTMLInputElement | null): void => {
    if (!typedRef.current) focusUnlessTyping(el)
  }, [])

  const inAccounts = accountList.showing
  const { onKeyDown: navKeyDown } = useListboxNav({
    count: inAccounts ? accounts.accounts.length : shown.length,
    active,
    setActive,
    onChoose: () => {
      if (inAccounts) {
        const chosen = accounts.accounts[active]
        if (chosen !== undefined) accountList.pick(chosen.id)
        return
      }
      const picked = shown[active]
      if (picked !== undefined) choose(picked)
      else if (query.trim() !== '') { close(); onRun(`/${query.trim().replace(/^\//, '')}`) }
    },
  })

  const onKeyDown = (e: KeyboardEvent): void => {
    if (inAccounts && e.key === 'ArrowLeft') { e.preventDefault(); accountList.back() } else navKeyDown(e)
  }

  // In the message box, keys the menu does not use (and Enter with nothing to pick) stay the box's.
  keyHandler.current = typed
    ? (e) => {
        if (e.key === 'Escape') { if (inAccounts) accountList.back(); else setDismissedFor(composerText); return true }
        if (e.key === 'Enter' && shown.length === 0 && !inAccounts) return false
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter' && !(inAccounts && e.key === 'ArrowLeft')) return false
        onKeyDown(e)
        return true
      }
    : null

  const footer = inAccounts ? '' : footerText(shown[active])

  return (
    <div ref={root}>
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
            ref={focusSearchOnMount}
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
          {inAccounts && (
            <AccountOptions
              accounts={accounts.accounts} currentId={accountList.currentId} active={active} listId={listId}
              onMouseEnter={setActive} onChoose={(a) => { accountList.pick(a.id) }}
            />
          )}
          {!inAccounts && shown.length > 0 && <ActionsList shown={shown} active={active} listId={listId} onMouseEnter={setActive} onChoose={choose} />}
          {!inAccounts && shown.length === 0 && <EmptyNote started={commands !== null} />}
          {footer !== '' && <div className="chat-command-footer" data-testid="composer-command-footer">{footer}</div>}
        </Popover>
      )}
    </div>
  )
}
