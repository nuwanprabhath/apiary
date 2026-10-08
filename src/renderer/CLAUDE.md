# src/renderer — the React UI

Read with root CLAUDE.md; this covers xterm integration, terminal painting, controls and the parts
of theming that live in CSS. No Node access here — everything reaches main only through
`window.apiary` (`src/shared/ipc/contract.ts`'s `ApiaryApi`, implemented by `src/preload/index.ts`),
and only from `state/`: commands and the error policy are in [`state/CLAUDE.md`](state/CLAUDE.md).
See also [`src/main/pty/CLAUDE.md`](../main/pty/CLAUDE.md) for the pty side of the terminal, and
[`src/shared/theme/CLAUDE.md`](../shared/theme/CLAUDE.md) for the theme data model.

## Terminal key handling

Key handling in the terminal goes through xterm's `attachCustomKeyEventHandler`. A DOM listener on
the host element runs *after* xterm has already written to the PTY, so `preventDefault()` there
cannot stop a key — which is how you end up copying a selection *and* sending SIGINT.

## Terminals: painting and prompts

- **The host paints the terminal's colour, xterm paints none** (`.terminal-host` background is
  `--term-background`, `.xterm-viewport` transparent). xterm draws whole rows only; the sliver
  under the last one used to show whatever was behind — a bar on glass. Rows are **bottom-anchored**
  (`justify-content: flex-end`), so every pane ends its text the same distance from the edge.

## Theming (renderer half)

The theme data model, validation and effects live in `src/shared/theme/` — see that folder's
`CLAUDE.md`. The renderer-only conventions:

- **Anything floating is solid** on solid themes: dialogs, menus, hover cards, toasts paint the
  panel colour over `--bg`, because a theme's translucent chrome let the transcript show through a
  dialog. On glass they are panes at ≥ 94% tint (`--bg-popover`) — no blur.
- **Corners come from the theme**: `--radius-sm`/`--radius-row`/`--radius-lg` in `styles.css` are
  `calc()`s of `--radius-panel` (4/5/10 px at the default 8), `--radius-control` is set by the
  theme. Never write a literal px radius above 3px in `styles.css` — Stylelint enforces this.
- **There is no `backdrop-filter` anywhere, on purpose.** What shows through a glass pane is only
  the window colour and the back effects canvas, so `ThemeEffects` draws that canvas blurred (at a
  fraction of the window's resolution, scaled up) and saturated, rather than filtering per pane live.
  A live backdrop filter per pane — the first version, with an SVG lens — re-ran on every frame and
  hover and made the app lag by ~800 ms without GPU compositing. "Refraction" is now a lens-edge
  glow in `--glass-rim`, drawn as a `::before` on each card (and on `.sidebar-frame`).
- The active theme reaches a window before its first paint through a synchronous preload read
  (`initialTheme`); components mounted later must ask `themeState()`, not trust that snapshot.

## Conventions

- **`styles.css` uses CSS custom properties for colour *and* for shape.** No literal colours (the
  scrollbar arrow data-URI SVGs are the one documented exception), and no literal control heights,
  paddings, corner radii or focus rings either — they are tokens at the top of the file for the
  same reason: a theme is not only a palette.
- **Focus is never taken from a text field, and a live region never ticks.** Something that
  appears on its own (a permission prompt) moves focus with `focusUnlessTyping`
  (`ui/focusUnlessTyping.ts`; `focus-unless-typing` flags `autoFocus` and a mount-time
  `.focus()` elsewhere), because the Enter meant to send a message approved a tool. A
  `role="status"` / `aria-live` region holds a state ("Claude is working"), set once; a clock,
  counter or rotating word beside it is `aria-hidden`, or a screen reader reads "N s" all turn
  (`WorkingLine`). Nothing lints the second: `role="status"` is right in six places and "ticking" is
  data flow, not syntax, so `transcriptChat.test.tsx` asserts the live text stays put as time passes.
- **Controls go through the control layer**, not through a rule of their own. Every button that
  looks like a button resolves one base rule; `.btn` is what new markup uses, with `.primary` and
  `.danger` for the filled variants and `.small` for a compact one. The app previously had six
  near-identical button rules with four different paddings between them, which is how a Cancel and
  a Save ended up side by side at different heights — and a button belonging to none of them fell
  through to Chromium's native macOS control, which is white and looks like another application's.
  Checkboxes are drawn by the app for that second reason: `accent-color` alone only colours the
  checked state, leaving the unchecked box white in a dark panel.

## Sidebar virtualization: measured and rejected

The 2026-09-26 review proposed `content-visibility: auto` on collapsed sidebar groups as a cheap
step before full list virtualization (UI-9). It was tried and rejected after measuring: Chromium
empties a skipped row's `element.innerText` while `content-visibility: auto` is hiding it, and
`tests/e2e/nestedReorder.spec.ts` — which reads row text to assert drag-and-drop order — broke
against real rows, not a test artifact. Anything that reads rendered text from an off-screen but
still-mounted row (search-in-DOM, accessibility tooling, this kind of test) is incompatible with
`content-visibility: auto` on that row. Full virtualization (unmounting instead of hiding) was
judged not worth the complexity at the sidebar sizes actually seen; do not reach for
`content-visibility` here again without solving the `innerText` problem first.

## The title bar (`features/titleBar/`)

Windows and Linux get Apiary's own title bar and menu bar, in the theme's colours; the OS still
draws minimise/maximise/close over its right end (Electron's `titleBarOverlay`), coloured from the
theme on every theme change (`setTitleBarColors`). A Mac keeps its system menu bar and gets a
themed strip beside the traffic lights (`titleBarStyle: 'hiddenInset'`). Which one a window has is
decided by main and carried in its URL (`chrome=`, `WindowChrome`), because it decides the layout
from the first paint. "Use the system title bar" (Settings → General) turns it all off.

- **There is one menu.** `MenuBar` draws main's real application menu (`appMenu`) and runs items
  through it (`appMenuInvoke`), so every command, label and shortcut lives in `main/app/menu.ts`.
  The application menu is set before any window opens; a window asking earlier would draw nothing.
- **Focus goes back before an item runs**, or Edit → Paste would paste into the menu.
- **The page is the whole window** under a custom bar or hiddenInset: `window.innerHeight` equals the
  window's height (an e2e assumption `sessionTabs.spec.ts` had to drop).

## Shape of the big components (UI-1, UI-19, UI-21)

`app/App.tsx` is providers, the grid and the `columns.map`; what it used to own lives in hooks:
workspace state in `features/workspace/` (reducer, provider, effect hooks), dialogs in
`features/dialogs/` (`useDialogs` state, `DialogHost` rendering, and `useDialogActions()` so the
sidebar opens delete/move/note/worktree dialogs itself rather than through props), the two resizers
in `ui/useResizeDrag.ts` (a draggable, keyboard-operable separator — the one place a drag is written), and the pane-divider positions in `features/layout/PaneGrid.tsx`.

- **`features/sidebar/Sidebar.tsx`** is the search box, the data every section reads, and the
  composition. Each section is a component (`ActiveSection`, `PinnedSection`, `RecentSection`,
  `PendingSection`, `SearchResults`, `FolderGroup`) that owns its own `useFlatTreeNav`; the
  group arrangement (`useGroupActions`), the one context menu (`useSidebarMenu`), the main
  folder/session tree's keyboard model (`useMainTreeNav`) and scroll-to-reveal (`useRevealSession`)
  are hooks. Rows take their callbacks as one stable `RowActions` object (`rowActions.ts`).
- **`features/pane/SessionColumn.tsx`** composes `SessionHeader`, `SessionBody` and `ShellPane`;
  git state is `useGitStatus` + `useGitActions`, shell terminals are `useShellTerminals` and
  `useSessionKeys` maps a tab to the id its ptys hang off. A pane takes no workspace data as props:
  `usePaneWorkspace(tabKeys)` selects the sessions, pending sessions, live processes and shell maps
  behind its own tabs from the workspace store, and the setters are context-stable.
- **`Sidebar`, `SessionColumn` and `SessionRow` are `React.memo`.** That only works while App's props
  to them stay referentially stable, so a new handler passed to either must be a `useCallback`/
  `useMemo` in App (or read from context). `tests/component/appPropStability.test.tsx` fails when
  one stops being stable; it finds the components by their inner function names (`SidebarShell`,
  `SessionColumnView`, `SessionRowView`), so keep those names.

## The workspace store and panes (`features/workspace/`)

The window's tabs, terminals and layout are the pure `workspaceReducer` behind a small external
store (`workspaceStore.ts`, `useSyncExternalStore`), not a `useReducer` in a context. Nothing
re-renders because the workspace did; a component re-renders when what it **selected** changes.

- **A pane reads a slice** with `useWorkspaceSelector(selector, equal?)` (via `usePaneWorkspace`). A
  selector that builds a new map or object needs an `equal`, or it re-renders on every transition.
  `useWorkspace()` is the whole state and re-renders on every transition: App's window-level hooks
  use it, a pane never does (the `workspace-via-selector` lint rule).
- **A handler every pane receives reads the store when it runs** (`useWorkspaceStore().getState()`),
  not through a render's closure — `transferFor`, `onResume`, the per-column handlers. A closure over
  `resumed` or `openSessions` was a new function per change and rendered every pane.
- `dispatch` is applied synchronously and in call order, like `useReducer`'s queue; the reducer and
  the effect ordering (session following, pending sessions, pty lifecycle, launch restore) are
  unchanged. `tests/component/appPropStability.test.tsx` counts real renders per pane
  (`renderTracker.ts`) so a change in pane A that renders pane B fails.
