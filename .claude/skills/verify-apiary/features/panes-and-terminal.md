# Panes, tabs and terminals

Opening a session puts it in a tab. Tabs move between pane layouts (halves, thirds and so on)
through a layout picker. Each session has a terminal (`terminal-session`, for `claude --resume`)
and a shell (`terminal-shell`) owned by main, which survive moves between panes.

## Sub-features

- Tabs (`session-tab`) and the layout picker (`session-tab-layout` → `layout-picker` →
  `layout-zone-<preset>-<n>`, e.g. `layout-zone-halves-h-2`). `content` carries `data-preset`.
- The shell toggle (`shell-toggle`) and the shell itself (`terminal-shell`).
- Resume (`resume-button`) starts the session's `claude` in `terminal-session`.
- Transcript and terminal views (`view-transcript`, `view-terminal`).

## How to get to it (user POV)

Click a session in the sidebar; hover a tab's layout button to pick a pane.

## Driving it with launchApiary

```ts
await sidebarSession(h.page, 'Fix CSV export bug').click()
await h.page.getByTestId('shell-toggle').click()
await h.page.getByTestId('terminal-shell').click()
await h.page.keyboard.type('echo HELLO_$((6*7))\n')       // arithmetic, so the echo of the
await expect(h.page.getByTestId('terminal-shell')).toContainText('HELLO_42') // typed line can't match
```

The picker opens on hover, which can miss while the layout settles; retry it the way
`openPickerOn` in `paneLayouts.spec.ts` does (`expect(async () => { hover; visible }).toPass()`).

Proof: `content`'s `data-preset`, which pane holds which tab, and text still in the shell after a
move (the pty belongs to main, so output must survive a remount).

## Gotchas

- Resume runs the stand-in `claude` (a login shell) unless `claudeBin` says otherwise.
- Typing into a terminal needs a click on it first to focus xterm.
