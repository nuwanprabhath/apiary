# Scheduled messages

A message set to go to a session at a time, sent by Apiary while it is open or by a one-time OS job
while it is closed (`src/main/schedule/CLAUDE.md`).

## Sub-features

- Dialog (`schedule-text`, `schedule-date`, `schedule-time`, quick picks `schedule-pick-limit`,
  `schedule-pick-hour`, `schedule-pick-tomorrow`; `schedule-save`, `schedule-cancel`,
  `schedule-delete`). Empty text sends "continue"; the default time is five minutes after the usage
  limit resets (`schedule-source` says where the time came from).
- `schedule-open-only` shows when no OS scheduler exists: it sends only while Apiary is open.
- The bar above the message box (`schedule-bar`, `schedule-chip`, `schedule-summary`) with Edit,
  Send now and Cancel, and notices for messages sent while closed or failed (`schedule-notice`,
  `schedule-notice-dismiss`).

## How to get to it (user POV)

Right-click a sidebar row or a tab → "Schedule a message…", or type "/" in the chat box and pick it.

## Driving it with launchApiary

With chat mode on (`claudeBin` = `tests/fixtures/fake-claude-chat.mjs`, `transcriptChat: true`),
type "/" in `composer-input`, click the `composer-action-option` with `data-action="schedule-message"`;
proof: `schedule-text` is visible. Saving and the bar: `tests/component/schedule.test.tsx`.

## Gotchas

- No e2e spec except the live one (`tests/e2e/live/scheduledMessage.spec.ts`, real Haiku, opt-in).
- An OS job is real (a LaunchAgent, `systemd-run`, `at`): the e2e harness turns OS jobs off.
