# Multi-Terminal Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bottom pane's single shell into a list of independently-running terminals per session — add via a "+" button, switch via a side panel, rename inline, delete via a trash icon — VS Code-style.

**Architecture:** Builds on the `Toolbar` component from the git-toolbar plan (`docs/superpowers/plans/2026-09-05-git-toolbar.md`, run first). `AppService.openShell`/`openShellForPty` gain a `tabId` parameter so more than one pty can exist per session, keyed `shell:<key>:<tabId>`. `App.tsx`'s single `shells: Set<string>` becomes a per-session list of named tabs plus which one is active; a new `TerminalListPanel` renders that list. Renaming is renderer-only state (not persisted), matching the app's existing not-persisted-across-restart shell bookkeeping.

## Global Constraints

- Deleting a pty always goes through the existing `ptyKill` channel — no new backend call needed for delete.
- Every new/renamed/deleted terminal is scoped to the current session's `shellKey`, exactly like the existing single shell already is (a different session's terminals are a separate list).
- `npm run typecheck` and the full test suite (`npm test`, then relevant e2e specs) must stay green after every task.
- Depends on the git-toolbar plan's `Toolbar` component (`src/renderer/components/Toolbar.tsx`) and `icons.tsx` already existing — do not start this plan until that one is merged.

---

### Task 1: Backend — per-tab pty ids

**Files:**
- Modify: `src/main/appService.ts` (`openShell`, `openShellForPty`)
- Modify: `src/shared/api.ts` (`ApiaryApi.openShell`/`openShellForPty` signatures)
- Modify: `src/main/ipc.ts` (handler signatures)
- Modify: `src/preload/index.ts` (wiring)
- Test: `tests/integration/appService.test.ts`

**Interfaces:**
- Consumes: `resolveShellCwd` (private, from the git-toolbar plan's Task 3).
- Produces (consumed by Task 2):
  - `AppService.openShell(sessionId: string, tabId: string): Promise<void>` — spawns
    `shell:<sessionId>:<tabId>`.
  - `AppService.openShellForPty(ptyId: string, tabId: string): Promise<void>` — spawns
    `shell:<ptyId>:<tabId>`.
  - `window.apiary.openShell(sessionId: string, tabId: string): Promise<void>` — same, renderer-side.
  - `window.apiary.openShellForPty(ptyId: string, tabId: string): Promise<void>` — same.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/appService.test.ts`, in the existing terminal-related `describe` block
(or a new one near it):

```ts
describe('multi-tab shells', () => {
  it('spawns distinct ptys for two tabs of the same session', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])

    await service.openShell('11111111-1111-1111-1111-111111111111', '1')
    await service.openShell('11111111-1111-1111-1111-111111111111', '2')
    expect(service.pty.has('shell:11111111-1111-1111-1111-111111111111:1')).toBe(true)
    expect(service.pty.has('shell:11111111-1111-1111-1111-111111111111:2')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- appService`
Expected: FAIL — either a type error (extra argument) or the pty id assertions fail because the
current code spawns `shell:<sessionId>` with no tab suffix.

- [ ] **Step 3: Update `AppService`**

In `src/main/appService.ts`, replace the two methods (as they exist after the git-toolbar plan's
Task 3 refactor) with:

```ts
  /** Spawns a plain interactive shell in the session's cwd, keyed `shell:<id>:<tabId>` — more
   *  than one tab can exist per session; each is addressed by its own tabId. */
  async openShell(sessionId: string, tabId: string): Promise<void> {
    const cwd = this.resolveShellCwd(sessionId, false)
    this.pty.spawn({ id: `shell:${sessionId}:${tabId}`, cwd, command: 'exec "$SHELL" -l' })
  }

  /**
   * Same as `openShell`, but for a new session's pty before it has a real session id yet, keyed
   * `shell:<ptyId>:<tabId>`.
   */
  async openShellForPty(ptyId: string, tabId: string): Promise<void> {
    const cwd = this.resolveShellCwd(ptyId, true)
    this.pty.spawn({ id: `shell:${ptyId}:${tabId}`, cwd, command: 'exec "$SHELL" -l' })
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- appService`
Expected: PASS

- [ ] **Step 5: Update the shared API, IPC, and preload wiring**

In `src/shared/api.ts`, change the `ApiaryApi` signatures:

```ts
  openShell(sessionId: string, tabId: string): Promise<void>
  openShellForPty(ptyId: string, tabId: string): Promise<void>
```

In `src/main/ipc.ts`, change the handlers:

```ts
  ipcMain.handle(CHANNELS.openShell, (_e, id: string, tabId: string) => service.openShell(id, tabId))
  ipcMain.handle(CHANNELS.openShellForPty, (_e, id: string, tabId: string) =>
    service.openShellForPty(id, tabId),
  )
```

In `src/preload/index.ts`, change the wiring:

```ts
  openShell: (id, tabId) => ipcRenderer.invoke(CHANNELS.openShell, id, tabId),
  openShellForPty: (id, tabId) => ipcRenderer.invoke(CHANNELS.openShellForPty, id, tabId),
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: errors in `src/renderer/App.tsx` (both call sites now missing the required `tabId`
argument) — expected and fixed in Task 2, not here.

- [ ] **Step 7: Commit**

```bash
git add src/main/appService.ts src/shared/api.ts src/main/ipc.ts src/preload/index.ts tests/integration/appService.test.ts
git commit -m "feat: add a tabId parameter to openShell/openShellForPty for multiple terminals per session"
```

---

### Task 2: `App.tsx` — per-session terminal tab list and active-tab state

**Files:**
- Modify: `src/renderer/App.tsx`
- Test: existing `tests/e2e/terminal.spec.ts`, `tests/e2e/newSession.spec.ts` (must keep passing
  unchanged — no new test file for this task; it's a pure state-model refactor with no new UI)

**Interfaces:**
- Consumes: `window.apiary.openShell(sessionId, tabId)`, `.openShellForPty(ptyId, tabId)` (Task 1);
  `window.apiary.ptyKill(id)` (already exists).
- Produces (consumed by Task 3):
  - `interface TerminalTab { id: string; name: string }`
  - `shellTabs: Map<string, TerminalTab[]>` — tabs open for each `shellKey`.
  - `activeTabId: Map<string, string>` — which tab is currently shown for each `shellKey`.
  - `addTerminalTab(): Promise<void>` — spawns and switches to a new tab for the current `shellKey`.
  - `renameTerminalTab(tabId: string, name: string): void`
  - `deleteTerminalTab(tabId: string): void` — kills the pty; if it was the active tab, switches to
    another remaining one, or collapses the pane (`setShellOpen(false)`) if none remain.
  - `switchTerminalTab(tabId: string): void`
  - `currentTabs: TerminalTab[]` and `activeTab: TerminalTab | null` — derived, for Task 3 to render.

- [ ] **Step 1: Replace the shell state and `toggleShell`**

In `src/renderer/App.tsx`, replace the state declaration (`const [shells, setShells] = useState<Set<string>>(new Set())`,
next to `shellOpen`) with:

```ts
  interface TerminalTab { id: string; name: string }
  const [shellTabs, setShellTabs] = useState<Map<string, TerminalTab[]>>(new Map())
  const [activeTabId, setActiveTabId] = useState<Map<string, string>>(new Map())
```

Replace `toggleShell` (the function using `shells`/`setShells`) with:

```ts
  const toggleShell = useCallback(async () => {
    if (shellKey === null) return
    if (shellOpen) { setShellOpen(false); return }
    if (!shellTabs.has(shellKey)) {
      try {
        if (shellKeyIsPtyId) await window.apiary.openShellForPty(shellKey, '1')
        else await window.apiary.openShell(shellKey, '1')
        setShellTabs((prev) => new Map(prev).set(shellKey, [{ id: '1', name: 'Terminal 1' }]))
        setActiveTabId((prev) => new Map(prev).set(shellKey, '1'))
      } catch (e) {
        setError((e as Error).message)
        return
      }
    }
    setShellOpen(true)
  }, [shellKey, shellKeyIsPtyId, shellOpen, shellTabs])
```

- [ ] **Step 2: Add the tab-management callbacks**

Add just below `toggleShell`:

```ts
  const currentTabs = shellKey !== null ? shellTabs.get(shellKey) ?? [] : []
  const activeTab = currentTabs.find((t) => t.id === activeTabId.get(shellKey ?? '')) ?? currentTabs[0] ?? null

  const addTerminalTab = useCallback(async () => {
    if (shellKey === null) return
    const existing = shellTabs.get(shellKey) ?? []
    const nextN = existing.length + 1
    // Numeric ids increment forever within a session's lifetime rather than reusing a freed
    // number, so a just-deleted tab's pty id can never collide with a new tab's.
    const maxId = existing.reduce((m, t) => Math.max(m, Number(t.id)), 0)
    const newId = String(maxId + 1)
    try {
      if (shellKeyIsPtyId) await window.apiary.openShellForPty(shellKey, newId)
      else await window.apiary.openShell(shellKey, newId)
      setShellTabs((prev) => new Map(prev).set(shellKey, [...existing, { id: newId, name: `Terminal ${String(nextN)}` }]))
      setActiveTabId((prev) => new Map(prev).set(shellKey, newId))
      setShellOpen(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [shellKey, shellKeyIsPtyId, shellTabs])

  const renameTerminalTab = useCallback((tabId: string, name: string) => {
    if (shellKey === null) return
    setShellTabs((prev) => {
      const list = prev.get(shellKey) ?? []
      const next = new Map(prev)
      next.set(shellKey, list.map((t) => (t.id === tabId ? { ...t, name } : t)))
      return next
    })
  }, [shellKey])

  const switchTerminalTab = useCallback((tabId: string) => {
    if (shellKey === null) return
    setActiveTabId((prev) => new Map(prev).set(shellKey, tabId))
  }, [shellKey])

  const deleteTerminalTab = useCallback((tabId: string) => {
    if (shellKey === null) return
    window.apiary.ptyKill(`shell:${shellKey}:${tabId}`)
    setShellTabs((prev) => {
      const list = (prev.get(shellKey) ?? []).filter((t) => t.id !== tabId)
      const next = new Map(prev)
      if (list.length === 0) {
        next.delete(shellKey)
        setShellOpen(false)
      } else {
        next.set(shellKey, list)
      }
      return next
    })
    setActiveTabId((prev) => {
      if (prev.get(shellKey) !== tabId) return prev
      const remaining = (shellTabs.get(shellKey) ?? []).filter((t) => t.id !== tabId)
      const next = new Map(prev)
      if (remaining.length === 0) next.delete(shellKey)
      else next.set(shellKey, remaining[0].id)
      return next
    })
  }, [shellKey, shellTabs])
```

- [ ] **Step 3: Update the bottom-pane terminal render**

Replace the shell `TerminalView` render (the block that currently reads
`{shellOpen && shells.has(shellKey) && (<TerminalView ptyId={'shell:' + shellKey} testId="terminal-shell" />)}`)
with:

```tsx
                {shellOpen && activeTab !== null && (
                  <TerminalView ptyId={`shell:${String(shellKey)}:${activeTab.id}`} testId="terminal-shell" />
                )}
```

- [ ] **Step 4: Run the existing e2e suite to confirm no regression**

Run: `npm run typecheck`
Run: `npm run test:e2e -- terminal newSession`
Expected: PASS — these specs only ever open and use the first/default tab (id `'1'`, testid
`terminal-shell`), so the tab list being size 1 behind the scenes is invisible to them.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "refactor: model open shells as a per-session list of named tabs"
```

---

### Task 3: `TerminalListPanel` — add/switch/rename/delete UI

**Files:**
- Create: `src/renderer/components/TerminalListPanel.tsx`
- Modify: `src/renderer/components/icons.tsx` (add `PlusIcon`, `ListIcon`, `TrashIcon`)
- Modify: `src/renderer/App.tsx` (toolbar right-group buttons, render the panel)
- Modify: `src/renderer/styles.css` (panel layout, tab row styles)

**Interfaces:**
- Consumes: `currentTabs`, `activeTab`, `addTerminalTab`, `renameTerminalTab`, `switchTerminalTab`,
  `deleteTerminalTab` (Task 2); `Toolbar`, `ToolbarButtonSpec` (git-toolbar plan, Task 4).
- Produces (consumed by Task 4): `TerminalListPanel`'s rendered rows, each
  `data-testid="terminal-tab-row"` with a nested `data-testid="terminal-tab-delete"` button, and
  the toolbar's `data-testid="terminal-add"` / `data-testid="terminal-list-toggle"` buttons.

- [ ] **Step 1: Add the three new icons**

Append to `src/renderer/components/icons.tsx`:

```tsx
export function PlusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function ListIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.5 5h9M6.5 5V3.5h3V5M4.5 5l.6 8h5.8l.6-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
```

- [ ] **Step 2: Create `TerminalListPanel`**

Create `src/renderer/components/TerminalListPanel.tsx`:

```tsx
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
```

- [ ] **Step 3: Add CSS**

Append to `src/renderer/styles.css`:

```css
.terminal-panel-row { display: flex; flex: 1; min-height: 0; }
.terminal-list-panel {
  list-style: none;
  margin: 0;
  padding: 4px;
  width: 180px;
  flex: none;
  border-left: 1px solid var(--border);
  overflow-y: auto;
  background: var(--bg-panel);
}
.terminal-tab-row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  padding: 2px;
}
.terminal-tab-row[data-active="true"] { background: var(--selected); }
.terminal-tab-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminal-tab-rename-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 3px 5px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
.terminal-tab-delete {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  opacity: 0;
}
.terminal-tab-row:hover .terminal-tab-delete, .terminal-tab-row:focus-within .terminal-tab-delete { opacity: 1; }
.terminal-tab-delete:hover { background: var(--border); color: var(--danger); }
```

- [ ] **Step 4: Wire the panel and toolbar buttons into `App.tsx`**

Import at the top: `import { TerminalListPanel } from './components/TerminalListPanel'` and
`PlusIcon, ListIcon` from `./components/icons` (added to the existing icons import).

Add state for the panel's visibility, next to `gitBusy`:

```ts
  const [tabListOpen, setTabListOpen] = useState(false)
```

Fill in the `Toolbar`'s `right` array (git-toolbar plan's Task 4 left it as `right={[]}`):

```tsx
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
```

Wrap the terminal render (from Task 2's Step 3) and the panel in a row, replacing that block with:

```tsx
                <div className="terminal-panel-row">
                  {shellOpen && activeTab !== null && (
                    <TerminalView ptyId={`shell:${String(shellKey)}:${activeTab.id}`} testId="terminal-shell" />
                  )}
                  {shellOpen && tabListOpen && (
                    <TerminalListPanel
                      tabs={currentTabs}
                      activeId={activeTab?.id ?? null}
                      onSwitch={switchTerminalTab}
                      onRename={renameTerminalTab}
                      onDelete={deleteTerminalTab}
                    />
                  )}
                </div>
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/TerminalListPanel.tsx src/renderer/components/icons.tsx src/renderer/App.tsx src/renderer/styles.css
git commit -m "feat: add TerminalListPanel with add/switch/rename/delete controls"
```

---

### Task 4: E2E coverage for the multi-terminal panel

**Files:**
- Create: `tests/e2e/multiTerminal.spec.ts`

**Interfaces:**
- Consumes: `terminal-add`, `terminal-list-toggle`, `terminal-tab-row`, `terminal-tab-label`,
  `terminal-tab-rename-input`, `terminal-tab-delete`, `shell-toggle`, `terminal-shell` (Tasks 1-3).

- [ ] **Step 1: Write the tests**

Create `tests/e2e/multiTerminal.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.page.getByText('Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})
test.afterEach(async () => { await h.close() })

test('adds a second terminal and switches between them', async () => {
  await h.page.getByTestId('terminal-add').click()
  await h.page.getByTestId('terminal-list-toggle').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)

  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_TAB_TWO\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_TWO', { timeout: 20000 })

  await h.page.getByTestId('terminal-tab-row').first().getByTestId('terminal-tab-label').click()
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_TAB_ONE\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_ONE', { timeout: 20000 })
})

test('renames a terminal tab', async () => {
  await h.page.getByTestId('terminal-list-toggle').click()
  await h.page.getByTestId('terminal-tab-label').dblclick()
  await h.page.getByTestId('terminal-tab-rename-input').fill('Build watcher')
  await h.page.getByTestId('terminal-tab-rename-input').press('Enter')
  await expect(h.page.getByTestId('terminal-tab-label')).toHaveText('Build watcher')
})

test('deletes a terminal tab, switching to a remaining one', async () => {
  await h.page.getByTestId('terminal-add').click()
  await h.page.getByTestId('terminal-list-toggle').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)

  await h.page.getByTestId('terminal-tab-row').last().getByTestId('terminal-tab-delete').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(1)
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})

test('deleting the last terminal collapses the pane back to Show shell', async () => {
  await h.page.getByTestId('terminal-list-toggle').click()
  await h.page.getByTestId('terminal-tab-row').getByTestId('terminal-tab-delete').click()
  await expect(h.page.getByTestId('shell-toggle')).toHaveText('Show shell')
  await expect(h.page.getByTestId('terminal-shell')).toHaveCount(0)
})
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:e2e -- multiTerminal`
Expected: PASS (all 4 tests)

- [ ] **Step 3: Run the full suite and typecheck**

Run: `npm run typecheck`
Run: `npm test`
Run: `npm run test:e2e`
Expected: all green

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/multiTerminal.spec.ts
git commit -m "test: add e2e coverage for the multi-terminal panel"
```
