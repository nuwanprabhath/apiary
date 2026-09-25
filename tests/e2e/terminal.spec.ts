import { test, expect } from '@playwright/test'
import {
  launchApiary,
  importAll,
  relaunchApiary,
  countPtyKillCalls,
  ptyKillCallCount,
  countPtyResizeCalls,
  ptyResizeCallCount,
  type Harness,
  sidebarSession,
} from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
})

test.afterEach(async () => { await h.close() })

test('opens a bottom shell in the session working directory', { tag: '@smoke' }, async () => {
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
  // The prompt is shell-dependent, so assert on output we command ourselves.
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_SHELL_$(basename "$PWD")\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_SHELL_work-a', {
    timeout: 20000,
  })
})

test('resume switches the centre pane to a terminal and back', { tag: '@smoke' }, async () => {
  // Terminal *content* is not a reliable signal here: the resumed process is an interactive
  // CLI that can repaint its whole screen on the resize a remount triggers, so a torn-down and
  // rebuilt pane can look identical to one that was merely hidden. The IPC call that actually
  // ends the pty is the only signal that can't be spoofed by a redraw, so watch for it directly.
  await countPtyKillCalls(h.app)

  await h.page.getByTestId('resume-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()
  // The transcript pane must not merely exist unseen behind the terminal — both panes stay
  // mounted (see the reconciliation test), so the only thing distinguishing "active" from
  // "hidden" is actual visibility, not presence in the DOM.
  await expect(h.page.getByTestId('transcript')).toBeHidden()

  // Once a terminal exists for this session, Resume must stop being offered as an action (it
  // used to stay visible and just re-switch to the terminal tab, presenting as a fresh action
  // when the session was already running) — replaced by a running indicator on the Session tab.
  await expect(h.page.getByTestId('resume-button')).toHaveCount(0)
  await expect(h.page.getByTestId('session-live-dot')).toBeVisible()

  await h.page.getByTestId('view-transcript').click()
  await expect(h.page.getByTestId('transcript')).toBeVisible()
  // The terminal pane it just replaced must genuinely be hidden, not merely covered — proves
  // the tab switch actually took effect rather than both panes rendering on top of each other.
  await expect(h.page.getByTestId('terminal-session')).toBeHidden()
  // Resume must stay hidden regardless of which tab is active — the terminal existing, not the
  // current view, is what governs it.
  await expect(h.page.getByTestId('resume-button')).toHaveCount(0)
  // Switching views must not kill the process.
  await h.page.getByTestId('view-terminal').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()
  await expect(h.page.getByTestId('transcript')).toBeHidden()

  expect(await ptyKillCallCount(h.app)).toBe(0)
})

test('warns before resuming a session that is already running', async () => {
  // contextBridge freezes window.apiary, so the fake live session is seeded in
  // the main process via APIARY_FAKE_LIVE rather than patched in the renderer.
  await h.close()
  h = await launchApiary({ fakeLiveSessionId: '11111111-1111-1111-1111-111111111111' })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  await h.page.getByTestId('resume-button').click()
  await expect(h.page.getByTestId('conflict-dialog')).toBeVisible()
  await expect(h.page.getByTestId('conflict-dialog')).toContainText('4242')
  await h.page.getByTestId('conflict-cancel').click()
  await expect(h.page.getByTestId('conflict-dialog')).toHaveCount(0)
})

test('dragging the bottom-pane resizer persists the new height across a relaunch', async () => {
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()

  const bottomPane = h.page.locator('.bottom-pane')
  const before = await bottomPane.boundingBox()
  if (before === null) throw new Error('bottom pane has no bounding box')

  const resizer = h.page.getByTestId('bottom-resizer')
  const box = await resizer.boundingBox()
  if (box === null) throw new Error('resizer has no bounding box')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  // Dragging the handle up (decreasing Y) must grow the pane.
  await h.page.mouse.move(startX, startY)
  await h.page.mouse.down()
  await h.page.mouse.move(startX, startY - 120, { steps: 8 })
  await h.page.mouse.up()

  const dragged = await bottomPane.boundingBox()
  if (dragged === null) throw new Error('bottom pane has no bounding box after drag')
  expect(dragged.height).toBeGreaterThan(before.height + 80)

  await relaunchApiary(h)
  // The session is already restored as selected (Finding 1b) — its title now appears both in
  // the sidebar row and the header, so clicking by text alone would be ambiguous. Wait for the
  // restored header instead of re-clicking the (already redundant) sidebar row.
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()

  const afterRelaunch = await h.page.locator('.bottom-pane').boundingBox()
  if (afterRelaunch === null) throw new Error('bottom pane has no bounding box after relaunch')
  expect(Math.abs(afterRelaunch.height - dragged.height)).toBeLessThanOrEqual(2)
})

// Regression test for the same fit()/ResizeObserver feedback loop the centre-pane comment in
// styles.css describes (see newSession.spec.ts's "settles instead of oscillating" test), but
// triggered by dragging the bottom-pane resizer instead: .terminal-host previously had no
// `overflow: hidden`, so the shell terminal's own sub-pixel render overflow could bleed into
// `.content`'s `overflow: auto` while the drag continuously changes .bottom-pane's height,
// toggling a scrollbar on and off and oscillating cols/rows forever. That read as the shell's
// content (and cursor) flickering while resizing. `ptyResize` call volume is the real signal.
test('dragging the bottom-pane resizer does not oscillate the shell terminal size', { tag: '@serial' }, async () => {
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()

  await countPtyResizeCalls(h.app)

  const resizer = h.page.getByTestId('bottom-resizer')
  const box = await resizer.boundingBox()
  if (box === null) throw new Error('resizer has no bounding box')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  await h.page.mouse.move(startX, startY)
  await h.page.mouse.down()
  // A slow, multi-step drag maximises the number of ResizeObserver ticks the old code would
  // have had to (mis)handle, rather than a single jump that might settle before it can loop.
  await h.page.mouse.move(startX, startY - 150, { steps: 20 })
  await h.page.mouse.move(startX, startY - 20, { steps: 20 })
  await h.page.mouse.up()

  // eslint-disable-next-line playwright/no-wait-for-timeout -- the thing under test is the ptyResize call *rate* over a fixed window, which only a real elapsed interval can measure; there is no condition to poll for
  await h.page.waitForTimeout(1500)
  const afterSettle = await ptyResizeCallCount(h.app)
  // eslint-disable-next-line playwright/no-wait-for-timeout -- the thing under test is the ptyResize call *rate* over a fixed window, which only a real elapsed interval can measure; there is no condition to poll for
  await h.page.waitForTimeout(1500)
  const afterQuietWindow = await ptyResizeCallCount(h.app)

  // If the loop were present, this quiet window alone would rack up dozens more calls. A
  // stable layout adds at most a handful from legitimate one-off settling, never an unbounded
  // stream.
  expect(afterQuietWindow - afterSettle).toBeLessThan(5)
})

// Regression test: xterm registers its own native `paste` DOM listener on the terminal's
// textarea independently of attachCustomKeyEventHandler's keydown handling (see
// @xterm/xterm's Terminal._initGlobal / Clipboard.handlePasteEvent). The key handler used to
// read the clipboard and write it to the pty itself *as well as* letting that native listener
// fire, so the same text landed twice — once raw, once wrapped in bracketed-paste markers.
test('pasting writes the clipboard text once, with no bracketed-paste markers', { tag: '@serial' }, async () => {
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
  await h.page.getByTestId('terminal-shell').click()

  // Sets the real OS clipboard through Electron's own module, the way a person's copy would —
  // not `navigator.clipboard.writeText`, which a background page cannot always call without a
  // user gesture having happened first.
  const marker = 'APIARY_PASTE_MARKER'
  await h.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), marker)

  // Ctrl+Shift+V is the terminal's own paste chord on every platform (see TerminalView.tsx) and,
  // unlike a bare Ctrl+V, is never a control character the shell would swallow — pressing it here
  // exercises both paths at once: the custom key handler's own clipboard read, and the browser's
  // independent native `paste` event that xterm listens for on the same keypress.
  await h.page.keyboard.press('Control+Shift+V')

  await expect(h.page.getByTestId('terminal-shell')).toContainText(marker, { timeout: 10000 })
  const text = await h.page.getByTestId('terminal-shell').innerText()
  const occurrences = text.split(marker).length - 1
  expect(occurrences).toBe(1)
  expect(text).not.toContain('[200~')
  expect(text).not.toContain('[201~')
})

// Regression test, platform-specific chord: Ctrl+Shift+V is a real native paste shortcut on
// Linux (Chromium fires its own 'paste' DOM event for it, independent of any keydown handling),
// so that is what the test above drives. But Cmd+V is the actual OS-level paste binding on
// macOS, and the same risk applies to it: if Chromium there also fires a native 'paste' event as
// the default action of that chord, the key handler's own preventDefault() has to be the thing
// stopping it, same as for Ctrl+Shift+V on Linux — reasoning that the shift/meta branch structure
// covers it is not the same as having measured it. This drives whichever chord is this platform's
// own paste binding and asserts the same single-write, no-marker outcome.
test('pasting with the platform paste chord writes the clipboard text once, with no bracketed-paste markers', { tag: '@serial' }, async () => {
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
  await h.page.getByTestId('terminal-shell').click()

  const marker = 'APIARY_PASTE_MARKER_PLATFORM'
  await h.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), marker)

  const chord = process.platform === 'darwin' ? 'Meta+V' : 'Control+Shift+V'
  await h.page.keyboard.press(chord)

  await expect(h.page.getByTestId('terminal-shell')).toContainText(marker, { timeout: 10000 })
  const text = await h.page.getByTestId('terminal-shell').innerText()
  const occurrences = text.split(marker).length - 1
  expect(occurrences).toBe(1)
  expect(text).not.toContain('[200~')
  expect(text).not.toContain('[201~')
})
