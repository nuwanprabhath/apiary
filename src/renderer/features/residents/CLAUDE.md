# src/renderer/features/residents

Read with root CLAUDE.md and [`src/main/residents/CLAUDE.md`](../../../main/residents/CLAUDE.md).

- **What lives here.** The bee in the status bar (`ResidentBadge.tsx`: `ResidentBadges`, mounted by
  `features/statusBar/StatusBar.tsx` after the spacer, left of the plugin items) and its chat popup
  (`ResidentPopup.tsx`, mounted once per window by `ResidentsRoot` in `app/windowRegions.tsx`).
  The conversation is `ResidentConversation.tsx`, the message box `ResidentComposer.tsx`, the
  popup's rect and drags `usePopupRect.ts`. Styles: `styles/36-residents.css`.
- **Data.** Statuses from `state/residentsStore.ts`, the chat from `state/residentChat.ts`, which
  popup is open (and a question handed over) from `state/residentPopup.ts`. The rect, the draft and
  the last-seen message (the unread dot) are `uiState.ts` entries. No IPC here.
- **The looks are CSS on `data-state`** (asleep, idle, working): the halo, the glow, the wings, the
  pill and the taller bar. A new animation needs a `:root[data-motion="reduced"]` still frame.
- **The appearance is data, never the kind id.** `ResidentOrb` picks the glyph from
  `appearance.glyph` (`GLYPHS`: `BeeIcon`, `HoneypotIcon`), and sets `data-palette` and
  `data-animation`; the palette map in `36-residents.css` turns `data-palette` into the
  `--resident-tint*` variables every shared look (halo, glow, pill) is drawn in. A new palette is
  one rule there; a new glyph one entry in `GLYPHS`.
- **Needs you** (`attention` or `permissions`): `data-needs` on the badge pulses a `--danger` ring
  and hops the orb, `.resident-count` replaces the unread dot, and the pill says the summary unless
  it is working. The popup opening calls `markResidentSeen`; permission cards
  (`ResidentRequests.tsx`) leave only when answered.
- **Always say what it is doing.** Working, the pill shows `activity` ("Working…" if main ever
  sent none) and the popup's last row is `WorkingLine` (`BusyGlyph` plus the activity), apart
  from any streaming answer, so a cycle or a long shell command shows too. Hover, or keyboard
  focus, opens `ResidentHoverCard` on `useHoverCard`: name, blurb, then Now, Needs you, Checks,
  Digest and Setup (`residentCard.ts`, pure).
- **Right-click** (and the context-menu key, Shift+F10): `residentMenu.ts`, on the shared
  `ContextMenu`. "Settings…" goes through `revealResidentCard` (`state/residentSettings.ts`), which
  the Settings card takes once to scroll itself into view and flash.
- **Only the X closes the popup.** It is a `FloatingPanel` (`ui/`), not a `Modal`: no Escape, no
  outside click, no focus trap.
- **Sessions open through `useOpenSession`** (`features/workspace`), the path a resident's own
  `open_session` takes, for the chips (`MarkdownText`'s `chips` option turns
  `SESSION_LINK_PREFIX` links into buttons) and the instant-match cards.
- **Tests.** `tests/component/residentBadge.test.tsx`, `tests/component/residentPopup.test.tsx`,
  `tests/component/residentHoverCard.test.tsx`, and the UI scenarios in
  `tests/component/ui/residents.ui.test.tsx` and `tests/component/ui/residentStatus.ui.test.tsx`.
