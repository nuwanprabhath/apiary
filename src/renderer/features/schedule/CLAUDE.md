# src/renderer/features/schedule: scheduled messages

Read with root CLAUDE.md. Main owns the schedules and sends them (`src/main/schedule/`, Apiary open
or closed); this folder only shows them and asks main to change them, through
`src/renderer/state/scheduleStore.ts`.

- `ScheduleDialog.tsx`: "Schedule a message…" and "Edit…". Opened from anywhere with
  `openScheduleDialog` (a window-local store), rendered by `DialogHost`. An empty message sends
  "continue"; the time starts at main's suggestion (`scheduleDefault`).
- `ScheduleBar.tsx`: above the message box, the chip ("Sends “continue” at 3:05 pm today",
  "2 scheduled messages") with Edit…, Send now and Cancel, and a row per notice (sent while Apiary
  was closed, or failed), dismissed with `scheduleCancel` on its id.
- `ScheduleBadge.tsx`: the sidebar row's clock.
- `scheduleMenuItem` (`state/scheduleStore.ts`, so the plain `.ts` menu builders can use it): the one "Schedule a message…" item the sidebar row's menu and the
  tab's menu share; the chat's "/" menu has it as a `PaletteAction` (`features/chat/paletteActions.ts`).

Tests: `tests/component/schedule.test.tsx`, scenarios in `tests/component/ui/schedule.ui.test.tsx`.
