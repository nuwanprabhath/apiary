import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatus, SessionNode, WorktreeConflict, NewSessionInfo } from '@shared/types'
import type { Column, OpenTab } from '../state/columns'
import { findTab } from '../state/columns'
import { moveBefore } from '../state/groups'
import { SessionTabBar, type SessionTabView } from './SessionTabBar'
import { EditableSessionTitle } from './EditableSessionTitle'
import { Transcript } from './Transcript'
import { TerminalView } from './TerminalView'
import { TerminalListPanel } from './TerminalListPanel'
import { ResumeBar } from './ResumeBar'
import { Toolbar, type ToolbarButtonSpec } from './Toolbar'
import { usePluginBar, pluginButtons } from './pluginBar'
import { BranchSwitcher } from './BranchSwitcher'
import { WorktreeConflictDialog } from './WorktreeConflictDialog'
import { Composer } from './Composer'
import { ImageLightbox } from './ImageLightbox'
import { BranchIcon, ArrowDownIcon, ArrowUpIcon, CopyIcon, PlusIcon, ListIcon, EllipsisIcon } from './icons'
import { GitMenu, type GitMenuItem } from './GitMenu'
import { useNotifications } from '../state/notifications'

/** A shell terminal inside one session's shell pane. */
export interface TerminalTab { id: string; name: string }

/** Everything a pending (not yet resolved) new session needs to render as a tab. */
export interface PendingTabInfo { ptyId: string; cwd: string; label: string }

interface Props {
  column: Column
  /** Real sessions for this column's tabs, by tab key. Pending tabs are absent here. */
  sessions: Map<string, SessionNode>
  /** Pending new sessions by pty id — a tab whose key is in here has no session row yet. */
  pending: Map<string, PendingTabInfo>
  /** Session ids with a live `claude` pty behind them. */
  resumed: Set<string>
  /** sessionId -> the `new:<uuid>` pty the session was originally started under. */
  ptyOverrides: Map<string, string>
  shellTabs: Map<string, TerminalTab[]>
  setShellTabs: React.Dispatch<React.SetStateAction<Map<string, TerminalTab[]>>>
  activeTerminal: Map<string, string>
  setActiveTerminal: React.Dispatch<React.SetStateAction<Map<string, string>>>
  bottomHeight: number
  onStartBottomResize: () => void
  isActive: boolean
  onFocus: () => void
  onActivateTab: (key: string) => void
  onCloseTab: (key: string) => void
  onSetView: (key: string, view: OpenTab['view']) => void
  onResume: (session: SessionNode) => void
  /** Resumes and resolves once the pty exists, so the composer can send straight afterwards. */
  onResumeAsync: (session: SessionNode) => Promise<void>
  onRenameSession: (session: SessionNode, title: string) => void
  onRenamePending: (ptyId: string, title: string) => void
  /** Splits this column's active session into a column of its own beside it. */
  onSplitActive: (key: string) => void
  /** Moves a tab within this column's strip, after a drag. */
  onReorderTab: (key: string, toIndex: number) => void
  /** Session ids in the sidebar's Pinned section, so the tab menu offers the right verb. */
  pinnedKeys: Set<string>
  onTogglePin: (key: string) => void
  /** A session started from this column that has no session id yet — the same bookkeeping the
   *  "+" button's new sessions go through. */
  onSessionStarted: (info: NewSessionInfo) => void
  /** Forks the session behind a tab, opening the fork beside it. */
  onFork: (key: string) => void
  /** A drag that ended with nothing in this window taking the tab. */
  onTabDropped: (key: string, at: { x: number; y: number }) => void
  /** Tears a tab off into a window of its own. */
  onDetach: (key: string, at: { x: number; y: number }) => void
  /** flex-grow weight, set by dragging the dividers between columns (see App.tsx). */
  weight: number
}

/**
 * One editor group: a strip of open session tabs, the active session's transcript or live
 * terminal, and that session's own shell pane underneath. Several of these sit side by side when
 * the user splits (see state/columns.ts), each with its own shell — so a split gives you a second
 * session *and* a second set of terminals, which is what "split the shell along with the session"
 * asks for.
 */
export function SessionColumn(props: Props): JSX.Element {
  const {
    column, sessions, pending, resumed, ptyOverrides, shellTabs, setShellTabs,
    activeTerminal, setActiveTerminal, bottomHeight, onStartBottomResize, isActive, onFocus,
    onActivateTab, onCloseTab, onSetView, onResume, onResumeAsync, onRenameSession, onRenamePending,
    onSplitActive, onReorderTab, pinnedKeys, onTogglePin, onFork, onTabDropped, onDetach,
    onSessionStarted,
    weight,
  } = props

  // Failures raised in here go to the app-wide notification stack rather than an in-pane banner:
  // a message that only exists inside one column is easy to miss (and impossible to see at all
  // once you have switched to another column), and every kind of failure now reads the same way
  // wherever it came from.
  const { notify, notifyError } = useNotifications()

  const [shellOpen, setShellOpen] = useState(false)
  const [tabListOpen, setTabListOpen] = useState(false)
  /** F2 in a shell: which terminal to rename. See TerminalListPanel's `renameRequest`. */
  const [renameRequest, setRenameRequest] = useState<{ id: string } | null>(null)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [gitBusy, setGitBusy] = useState<'pull' | 'push' | 'fetch' | null>(null)
  // The branch picker serves two jobs: choosing a branch to check out, and choosing one to merge
  // in. Null when closed, so one piece of state carries both "is it open" and "what for".
  const [branchPicker, setBranchPicker] = useState<'checkout' | 'merge' | 'create' | null>(null)
  /** A checkout refused because another worktree has the branch, and whether a follow-up is
   *  running — both actions shell out to git, and neither should be startable twice. */
  const [worktreeConflict, setWorktreeConflict] = useState<WorktreeConflict | null>(null)
  const [worktreeBusy, setWorktreeBusy] = useState(false)
  const [gitMenuOpen, setGitMenuOpen] = useState(false)
  /** The image being shown full size, from either the transcript or the composer. */
  const [lightbox, setLightbox] = useState<string | null>(null)

  const activeKey = column.activeKey
  const activeTab = activeKey !== null ? findTab(column, activeKey) : null
  const activeSession = activeKey !== null ? sessions.get(activeKey) ?? null : null
  const activePending = activeKey !== null ? pending.get(activeKey) ?? null : null

  /**
   * The id every pty for a tab hangs off: the session id normally, but the original `new:<uuid>`
   * pty id for a session that was started from "+" — a session started that way is only ever
   * *addressed* by its session id, while the main process still knows it by the pty it was spawned
   * under, so `ptyOverrides` keeps both the claude terminal and `shell:<key>:<n>` ids stable
   * across the moment the session resolves. Pending tabs are keyed by their pty id directly.
   */
  const keyFor = useCallback(
    (tabKey: string): string => (pending.has(tabKey) ? tabKey : ptyOverrides.get(tabKey) ?? tabKey),
    [pending, ptyOverrides],
  )
  /** Whether `keyFor` produced a pty id rather than a stored session id — the two take different
   *  main-process calls, since only a session id can be looked up in the store for its cwd. */
  const isPtyKey = useCallback(
    (tabKey: string): boolean => pending.has(tabKey) || ptyOverrides.has(tabKey),
    [pending, ptyOverrides],
  )

  const shellKey = activeKey !== null ? keyFor(activeKey) : null
  const shellKeyIsPtyId = activeKey !== null && isPtyKey(activeKey)
  // Plugins are asked again when the branch changes, which is the event that decides which merge
  // request (if any) belongs to what is in front of you.
  const { items: pluginItems } = usePluginBar(shellKey, shellKeyIsPtyId, gitStatus?.branch ?? null)

  const loadGitStatus = useCallback(() => {
    if (shellKey === null) { setGitStatus(null); return }
    void window.apiary.gitStatus(shellKey, shellKeyIsPtyId).then(setGitStatus).catch(() => setGitStatus(null))
  }, [shellKey, shellKeyIsPtyId])

  useEffect(() => { loadGitStatus() }, [loadGitStatus])

  /**
   * Re-read the branch on a timer, because the most common way to change branch in this app is to
   * type `git checkout` into the very terminal sitting below this toolbar — and nothing about that
   * is observable from here, so without polling the label goes stale and quietly lies.
   *
   * This is not the background *fetching* the packaging notes rule out: every call is a local
   * `git rev-parse` against an already-known directory, no network. Polls are skipped entirely
   * while the window is unfocused, so an app left open in the background costs nothing, and a
   * focus listener catches up the moment you come back.
   */
  useEffect(() => {
    if (shellKey === null) return
    const tick = (): void => { if (document.hasFocus()) loadGitStatus() }
    const timer = setInterval(tick, 5000)
    window.addEventListener('focus', loadGitStatus)
    return () => { clearInterval(timer); window.removeEventListener('focus', loadGitStatus) }
  }, [shellKey, loadGitStatus])

  const terminalsFor = useCallback(
    (tabKey: string): TerminalTab[] => shellTabs.get(keyFor(tabKey)) ?? [],
    [shellTabs, keyFor],
  )
  const activeTerminalFor = useCallback(
    (tabKey: string): string | null => {
      const list = terminalsFor(tabKey)
      const wanted = activeTerminal.get(keyFor(tabKey))
      return list.find((t) => t.id === wanted)?.id ?? list[0]?.id ?? null
    },
    [terminalsFor, activeTerminal, keyFor],
  )

  const currentTerminals = activeKey !== null ? terminalsFor(activeKey) : []
  const currentTerminalId = activeKey !== null ? activeTerminalFor(activeKey) : null

  const spawnTerminal = useCallback(async (id: string): Promise<void> => {
    if (shellKey === null) return
    if (shellKeyIsPtyId) await window.apiary.openShellForPty(shellKey, id)
    else await window.apiary.openShell(shellKey, id)
  }, [shellKey, shellKeyIsPtyId])

  // Guards `ensureShellFor` against firing twice for the same key before its first spawn has
  // committed to `shellTabs` — a ref (not state) because the check must be synchronous, and
  // because two columns showing the *same* split session share one `shellTabs` entry, so a
  // second column's own render could otherwise race a spawn already in flight from the first.
  const spawningRef = useRef<Set<string>>(new Set())
  /**
   * The "..." button itself is what the git menu opens from — not the toolbar around it, which
   * starts at the far left of the pane and so put the menu at the opposite end from the button
   * that opened it.
   */
  const gitMenuButtonRef = useRef<HTMLButtonElement>(null)
  /** The box the terminal list opens upward from — see the positioning note in GitMenu. */
  const toolbarRef = useRef<HTMLDivElement | null>(null)

  /**
   * Spawns a first terminal for `key` if it has none *live*. Shared by the "Show shell" button
   * and the auto-open effect below, so a session that already has a shell never gets a second
   * spawned out from under it, and a session whose shell was exited (`exit` at the prompt, its
   * dead tab pruned by App's pty-exit handler) reliably gets a fresh one either way.
   */
  const ensureShellFor = useCallback(async (key: string): Promise<void> => {
    if ((shellTabs.get(key) ?? []).length > 0) return
    if (spawningRef.current.has(key)) return
    spawningRef.current.add(key)
    try {
      await spawnTerminal('1')
      setShellTabs((prev) => new Map(prev).set(key, [{ id: '1', name: 'Terminal 1' }]))
      setActiveTerminal((prev) => new Map(prev).set(key, '1'))
    } finally {
      spawningRef.current.delete(key)
    }
  }, [shellTabs, spawnTerminal, setShellTabs, setActiveTerminal])

  const toggleShell = useCallback(async () => {
    if (shellKey === null) return
    if (shellOpen) { setShellOpen(false); return }
    try {
      await ensureShellFor(shellKey)
    } catch (e) {
      notifyError(e, 'Could not open a shell')
      return
    }
    setShellOpen(true)
  }, [shellKey, shellOpen, ensureShellFor, notifyError])

  /**
   * Auto-opens a shell for a tab that switches into view while the pane is already open but that
   * tab itself has never had one. `shellOpen` lives at the column level, not per tab — switching
   * to a session you have never shown the shell for used to leave the pane rendering nothing at
   * all (no terminal exists for that key yet, and nothing spawns one without a click), which read
   * as "Show shell did nothing" even though the pane genuinely was open. See
   * sessionTabs.spec.ts's "switching to a tab that never had a shell open" for the regression.
   *
   * Restricted to the focused column: two columns can show the same split session and would
   * otherwise both race to spawn its first terminal the moment either one opens its shell.
   */
  useEffect(() => {
    if (!isActive || !shellOpen || shellKey === null) return
    if ((shellTabs.get(shellKey) ?? []).length > 0) return
    void ensureShellFor(shellKey).catch((e: unknown) => { notifyError(e, 'Could not open a shell') })
  }, [isActive, shellOpen, shellKey, shellTabs, ensureShellFor, notifyError])

  const addTerminalTab = useCallback(async () => {
    if (shellKey === null) return
    const existing = shellTabs.get(shellKey) ?? []
    // Ids climb forever within a session rather than reusing a freed number, so a just-deleted
    // tab's pty id can never collide with a new one's; the name follows the id for the same reason.
    const maxId = existing.reduce((m, t) => Math.max(m, Number(t.id)), 0)
    const newId = String(maxId + 1)
    try {
      await spawnTerminal(newId)
      setShellTabs((prev) => new Map(prev).set(shellKey, [...existing, { id: newId, name: `Terminal ${newId}` }]))
      setActiveTerminal((prev) => new Map(prev).set(shellKey, newId))
      setShellOpen(true)
      // Reveal the list too: a new terminal is otherwise indistinguishable from the one already on
      // screen, so the click reads as having done nothing at all.
      setTabListOpen(true)
    } catch (e) {
      notifyError(e, 'Could not open a new terminal')
    }
  }, [shellKey, shellTabs, spawnTerminal, setShellTabs, setActiveTerminal, notifyError])

  const renameTerminalTab = useCallback((tabId: string, name: string) => {
    if (shellKey === null) return
    setShellTabs((prev) => {
      const list = prev.get(shellKey) ?? []
      return new Map(prev).set(shellKey, list.map((t) => (t.id === tabId ? { ...t, name } : t)))
    })
  }, [shellKey, setShellTabs])

  /** Drag-to-reorder within the terminal list, matching the tab strip and the sidebar. */
  const reorderTerminalTab = useCallback((tabId: string, beforeId: string) => {
    if (shellKey === null) return
    setShellTabs((prev) => {
      const list = prev.get(shellKey) ?? []
      const order = moveBefore(list.map((t) => t.id), tabId, beforeId)
      const byId = new Map(list.map((t) => [t.id, t]))
      const next = order.map((id) => byId.get(id)).filter((t): t is TerminalTab => t !== undefined)
      return new Map(prev).set(shellKey, next)
    })
  }, [shellKey, setShellTabs])

  const switchTerminalTab = useCallback((tabId: string) => {
    if (shellKey === null) return
    setActiveTerminal((prev) => new Map(prev).set(shellKey, tabId))
  }, [shellKey, setActiveTerminal])

  const deleteTerminalTab = useCallback((tabId: string) => {
    if (shellKey === null) return
    window.apiary.ptyKill(`shell:${shellKey}:${tabId}`)
    const list = (shellTabs.get(shellKey) ?? []).filter((t) => t.id !== tabId)
    setShellTabs((prev) => {
      const next = new Map(prev)
      if (list.length === 0) next.delete(shellKey)
      else next.set(shellKey, list)
      return next
    })
    setActiveTerminal((prev) => {
      if (prev.get(shellKey) !== tabId) return prev
      const next = new Map(prev)
      if (list.length === 0) next.delete(shellKey)
      else next.set(shellKey, list[0].id)
      return next
    })
    if (list.length === 0) setShellOpen(false)
  }, [shellKey, shellTabs, setShellTabs, setActiveTerminal])

  const runGitAction = useCallback(async (kind: 'pull' | 'push' | 'fetch') => {
    if (shellKey === null) return
    setGitBusy(kind)
    try {
      if (kind === 'pull') await window.apiary.gitPull(shellKey, shellKeyIsPtyId)
      else if (kind === 'fetch') await window.apiary.gitFetch(shellKey, shellKeyIsPtyId)
      else await window.apiary.gitPush(shellKey, shellKeyIsPtyId)
      // Both commands are silent when they succeed, which reads identically to nothing having
      // happened — the same confusion the Refresh button had before it grew a spinner.
      notify({
        kind: 'success',
        message: kind === 'pull' ? 'Pulled from upstream.'
          : kind === 'push' ? 'Pushed to upstream.'
          : 'Fetched from remote.',
      })
      loadGitStatus()
    } catch (e) {
      notifyError(e, kind === 'pull' ? 'Pull failed' : kind === 'push' ? 'Push failed' : 'Fetch failed')
    } finally {
      setGitBusy(null)
    }
  }, [shellKey, shellKeyIsPtyId, loadGitStatus, notify, notifyError])

  /**
   * The "..." menu's commands, grouped the way VS Code groups its own: the everyday remote
   * operations first, then everything branch-shaped behind one submenu, then the odds and ends.
   * Kept as data rather than markup so adding a command later is one more entry here.
   */
  const gitMenuItems: GitMenuItem[] = [
    { id: 'pull', label: 'Pull', disabled: gitBusy !== null, run: () => { void runGitAction('pull') } },
    { id: 'push', label: 'Push', disabled: gitBusy !== null, run: () => { void runGitAction('push') } },
    { id: 'fetch', label: 'Fetch', disabled: gitBusy !== null, run: () => { void runGitAction('fetch') } },
    {
      id: 'branch',
      label: 'Branch',
      separatorBefore: true,
      submenu: [
        { id: 'branch-checkout', label: 'Checkout to...', run: () => setBranchPicker('checkout') },
        { id: 'branch-create', label: 'Create Branch...', run: () => setBranchPicker('create') },
        { id: 'branch-merge', label: 'Merge Branch...', run: () => setBranchPicker('merge') },
      ],
    },
    {
      id: 'copy-branch',
      label: 'Copy Branch Name',
      separatorBefore: true,
      disabled: gitStatus?.branch == null,
      run: () => {
        if (gitStatus?.branch != null) void window.apiary.copyToClipboard(gitStatus.branch)
      },
    },
  ]

  const tabViews: SessionTabView[] = column.tabs.map((tab) => {
    const p = pending.get(tab.key)
    if (p !== undefined) return { key: tab.key, label: p.label, isPending: true }
    return { key: tab.key, label: sessions.get(tab.key)?.title ?? tab.key, isPending: false }
  })

  /** A pending session has no transcript to show, so its tab is always the live terminal. */
  const viewOf = (tab: OpenTab): OpenTab['view'] => (pending.has(tab.key) ? 'terminal' : tab.view)
  const showTerminalFor = (tab: OpenTab): boolean =>
    pending.has(tab.key) || resumed.has(tab.key)

  const activeView = activeTab !== null ? viewOf(activeTab) : 'transcript'

  return (
    <section
      className="session-column"
      data-testid="session-column"
      data-column-id={column.id}
      style={{ flexGrow: weight }}
      data-active={isActive}
      onFocusCapture={onFocus}
      onMouseDownCapture={onFocus}
    >
      <SessionTabBar
        tabs={tabViews}
        activeKey={activeKey}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onSplitActive={() => { if (activeKey !== null) onSplitActive(activeKey) }}
        onDropTab={onReorderTab}
        pinnedKeys={pinnedKeys}
        onTogglePin={onTogglePin}
        onFork={onFork}
        onTabDropped={onTabDropped}
        onDetach={onDetach}
      />

      {activeKey === null ? (
        <p className="empty" data-testid="content-empty">
          Select a session to view its transcript.
        </p>
      ) : (
        <>
          <header className="session-header">
            <h1 data-testid="session-title" className="session-title-heading">
              {activePending !== null ? (
                <>
                  New session &middot;{' '}
                  <EditableSessionTitle
                    key={activePending.ptyId}
                    title={activePending.label}
                    onRename={(title) => onRenamePending(activePending.ptyId, title)}
                  />
                </>
              ) : activeSession !== null ? (
                <EditableSessionTitle
                  key={activeSession.sessionId}
                  title={activeSession.title}
                  onRename={(title) => onRenameSession(activeSession, title)}
                />
              ) : null}
            </h1>
            <p className="session-cwd" data-testid="session-path">
              {activePending !== null ? activePending.cwd : activeSession?.cwd}
            </p>
          </header>

          {activePending === null && activeSession !== null && (
            <ResumeBar
              session={activeSession}
              view={activeView}
              hasTerminal={resumed.has(activeSession.sessionId)}
              onView={(v) => onSetView(activeSession.sessionId, v)}
              onResume={() => onResume(activeSession)}
            />
          )}

          <div className="centre-pane">
            {/* Only the active tab's transcript is mounted: it refetches and jumps to the newest
             *  message on mount anyway, so keeping the others alive would buy nothing and would
             *  multiply the live-update refetches by the number of open tabs. */}
            {activePending === null && activeSession !== null && (
              <div hidden={activeView !== 'transcript'} className="pane-fill">
                <Transcript
                  session={activeSession}
                  visible={activeView === 'transcript'}
                  onOpenImage={setLightbox}
                />
                {/* The chat box belongs to the transcript rather than the terminal: this is the
                  * reading view, and being able to reply without switching to the raw terminal is
                  * the whole point. What it types still goes to that terminal. */}
                <Composer
                  session={activeSession}
                  ptyId={keyFor(activeSession.sessionId)}
                  running={resumed.has(activeSession.sessionId)}
                  onResume={() => onResumeAsync(activeSession)}
                  onShowSession={() => onSetView(activeSession.sessionId, 'terminal')}
                  onOpenImage={setLightbox}
                />
              </div>
            )}
            {/* Every tab's claude terminal stays mounted, hidden, so switching tabs (or columns)
             *  never discards its scrollback — a fresh xterm starts empty and nothing replays a
             *  running pty's earlier output into it. */}
            {column.tabs.filter(showTerminalFor).map((tab) => {
              const visible = tab.key === activeKey && viewOf(tab) === 'terminal'
              return (
                // Keyed by the pty id, not the tab key: when a pending session resolves, its tab
                // is rekeyed from the pty id to the real session id, and keying off that would
                // make React tear this subtree down and build a new one — remounting xterm and
                // discarding everything printed during the pending phase. The pty id doesn't move.
                <div key={keyFor(tab.key)} hidden={!visible} className="pane-fill">
                  <TerminalView
                    ptyId={keyFor(tab.key)}
                    testId={visible ? 'terminal-session' : `terminal-session-${tab.key}`}
                    visible={visible}
                  />
                </div>
              )
            })}
          </div>

          {shellOpen && (
            <div
              className="bottom-resizer"
              data-testid="bottom-resizer"
              onMouseDown={(e) => { e.preventDefault(); onStartBottomResize() }}
            />
          )}

          <div className="bottom-pane" style={{ height: shellOpen ? bottomHeight : 32 }}>
            <div className="toolbar-anchor" ref={toolbarRef}>
            <Toolbar
              left={[
                {
                  id: 'shell-toggle',
                  // Rotates like every other chevron in the app instead of always pointing down,
                  // so the button states which way it will move the pane.
                  icon: (
                    <svg
                      className="chevron"
                      data-expanded={shellOpen}
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ),
                  label: shellOpen ? 'Hide shell' : 'Show shell',
                  title: shellOpen ? 'Hide shell' : 'Show shell',
                  testId: 'shell-toggle',
                  onClick: () => { void toggleShell() },
                },
                ...(gitStatus !== null
                  ? ([
                      {
                        id: 'git-branch',
                        icon: <BranchIcon />,
                        label:
                          gitStatus.branch === null
                            ? 'HEAD (detached)'
                            : gitStatus.branch +
                              (gitStatus.hasUpstream && (gitStatus.behind > 0 || gitStatus.ahead > 0)
                                ? ` (${gitStatus.behind > 0 ? '↓' + String(gitStatus.behind) : ''}${gitStatus.ahead > 0 ? '↑' + String(gitStatus.ahead) : ''})`
                                : ''),
                        title: 'Switch or create branch',
                        testId: 'toolbar-branch-button',
                        active: branchPicker !== null,
                        onClick: () => setBranchPicker('checkout'),
                      },
                      {
                        id: 'git-pull',
                        icon: <ArrowDownIcon className={gitBusy === 'pull' ? 'spinner' : undefined} />,
                        title: 'Pull',
                        testId: 'toolbar-pull',
                        disabled: gitBusy !== null,
                        onClick: () => { void runGitAction('pull') },
                      },
                      {
                        id: 'git-push',
                        icon: <ArrowUpIcon className={gitBusy === 'push' ? 'spinner' : undefined} />,
                        title: 'Push',
                        testId: 'toolbar-push',
                        disabled: gitBusy !== null,
                        onClick: () => { void runGitAction('push') },
                      },
                      {
                        id: 'git-copy',
                        icon: <CopyIcon />,
                        title: 'Copy branch name',
                        testId: 'toolbar-copy',
                        disabled: gitStatus.branch === null,
                        onClick: () => {
                          if (gitStatus.branch !== null) void window.apiary.copyToClipboard(gitStatus.branch)
                        },
                      },
                      {
                        id: 'git-more',
                        buttonRef: gitMenuButtonRef,
                        icon: <EllipsisIcon />,
                        title: 'More git commands',
                        testId: 'toolbar-git-menu',
                        active: gitMenuOpen,
                        onClick: () => setGitMenuOpen((v) => !v),
                      },
                    ] as ToolbarButtonSpec[])
                  : []),
                // Plugin buttons sit after git's, at the end of the left group: they are about the
                // same checkout, and anything contributed belongs after what Apiary itself owns.
                ...pluginButtons(pluginItems),
              ]}
              right={[
                {
                  id: 'terminal-add',
                  icon: <PlusIcon />,
                  title: 'New terminal',
                  testId: 'terminal-add',
                  onClick: () => { void addTerminalTab() },
                },
                {
                  id: 'terminal-list-toggle',
                  icon: <ListIcon />,
                  title: 'Toggle terminal list',
                  testId: 'terminal-list-toggle',
                  active: tabListOpen,
                  onClick: () => setTabListOpen((v) => !v),
                },
              ]}
            />
            </div>
            {gitMenuOpen && (
              <GitMenu
                items={gitMenuItems}
                anchorRef={gitMenuButtonRef}
                onClose={() => setGitMenuOpen(false)}
              />
            )}
            <div className="terminal-panel-row">
              {/* As with the claude terminals above, every open tab's shell terminals stay mounted
               *  so their scrollback survives switching session — a dev server you left running in
               *  one session is still showing its log when you come back to it. */}
              {column.tabs.flatMap((tab) => {
                const key = keyFor(tab.key)
                const shownTerminal = activeTerminalFor(tab.key)
                return terminalsFor(tab.key).map((terminal) => {
                  // Note `shellOpen` is part of *visibility*, not of whether this is rendered at
                  // all: collapsing the pane used to unmount every terminal in it, so hiding and
                  // reshowing the shell threw away the scrollback of anything running in it. A
                  // hidden terminal has no box for FitAddon to measure, so it never resizes its
                  // pty while collapsed either — the process is left completely undisturbed.
                  const visible = shellOpen && tab.key === activeKey && terminal.id === shownTerminal
                  return (
                    <div key={`${key}:${terminal.id}`} hidden={!visible} className="terminal-tab-view">
                      <TerminalView
                        ptyId={`shell:${key}:${terminal.id}`}
                        testId={visible ? 'terminal-shell' : `terminal-shell-${tab.key}-${terminal.id}`}
                        visible={visible}
                        onRenameKey={() => {
                          // The rename field lives in the terminal list, so F2 opens the list too —
                          // renaming something whose name is not on screen would be typing blind.
                          setTabListOpen(true)
                          setRenameRequest({ id: terminal.id })
                        }}
                      />
                    </div>
                  )
                })
              })}
              {shellOpen && tabListOpen && (
                <TerminalListPanel
                  tabs={currentTerminals}
                  activeId={currentTerminalId}
                  onSwitch={switchTerminalTab}
                  onRename={renameTerminalTab}
                  onDelete={deleteTerminalTab}
                  onReorder={reorderTerminalTab}
                  renameRequest={renameRequest}
                  onRenameRequestHandled={() => { setRenameRequest(null) }}
                />
              )}
            </div>
          </div>
        </>
      )}

      {lightbox !== null && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {branchPicker !== null && shellKey !== null && (
        <BranchSwitcher
          shellKey={shellKey}
          isPtyId={shellKeyIsPtyId}
          mode={branchPicker === 'merge' ? 'merge' : 'checkout'}
          startAt={branchPicker === 'create' ? 'name' : 'list'}
          currentBranch={gitStatus?.branch ?? null}
          onClose={() => setBranchPicker(null)}
          onCheckedOut={loadGitStatus}
          onError={(message) => notify({ kind: 'error', message })}
          onWorktreeConflict={setWorktreeConflict}
        />
      )}

      {worktreeConflict !== null && shellKey !== null && (
        <WorktreeConflictDialog
          conflict={worktreeConflict}
          busy={worktreeBusy}
          onCancel={() => setWorktreeConflict(null)}
          onPull={() => {
            setWorktreeBusy(true)
            void window.apiary.gitPullWorktree(shellKey, shellKeyIsPtyId, worktreeConflict.branch)
              .then(() => {
                notify({ message: `Pulled ${worktreeConflict.branch} in ${worktreeConflict.label}.` })
                setWorktreeConflict(null)
              })
              .catch((e: unknown) => { notifyError(e, `Could not pull ${worktreeConflict.branch}`) })
              .finally(() => setWorktreeBusy(false))
          }}
          onOpenSession={() => {
            setWorktreeBusy(true)
            void window.apiary.newSessionInWorktree(shellKey, shellKeyIsPtyId, worktreeConflict.branch)
              .then((info) => {
                onSessionStarted(info)
                setWorktreeConflict(null)
              })
              .catch((e: unknown) => { notifyError(e, 'Could not start a session there') })
              .finally(() => setWorktreeBusy(false))
          }}
        />
      )}
    </section>
  )
}
