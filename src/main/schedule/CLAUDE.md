# src/main/schedule: scheduled messages

Read with root CLAUDE.md. A message scheduled for a session goes out whether or not Apiary is open
at that time. The renderer only shows and edits schedules (`src/renderer/features/schedule/`).

## Two senders, one message

- **Apiary open:** `ScheduleService` arms one timer for the soonest schedule (re-armed at least
  every `MAX_TIMER_MS`, so a sleep or a clock change cannot stretch it) and delivers through the
  session's chat (`deliver`, built in `app/scheduleContainer.ts`).
- **Apiary closed:** each schedule also has a one-time OS job (`osScheduler.ts`): a LaunchAgent in
  the user's LaunchAgents folder on macOS (`launchctl bootstrap`/`bootout`), `systemd-run --user` on Linux,
  `at` when systemd is not there, `NO_OS_SCHEDULER` (the dialog says "Sends only while Apiary is
  open") when nothing is. The job runs the shell on the script `scheduledJobs.ts` writes to
  bin/apiary-scheduled in userData, with the schedule's id.

They never both send. The script reads `<id>.vars` (single-quoted shell assignments, never
interpolated text), exits if `apiary.pid` names a live process, writes `<id>.running`, runs `claude`
in the session's folder through the login shell, then `<id>.done` with the exit code, and removes
its own OS job last. Apiary, at a schedule's time, first reads `.done` (a notice: sent while closed),
then `.running` (the job is sending: look again every 30 s, never send it too; a `.running` older
than `STALE_RUNNING_MS` is a script that died), and only then sends and removes the job. A schedule
nobody sent within `MISSED_AFTER_MS` is shown as missed, never sent late on its own.

## Files

- `scheduleStore.ts`: the scheduled-messages.json file in userData (schedules and unseen notices), read through
  validators that drop a damaged entry and keep the rest.
- `limitReset.ts`: the default time, five minutes after the usage limit resets, read from Claude
  Code's limit line in the session file.
- Tests: `tests/unit/schedule/`; the real thing with Haiku: `tests/e2e/live/scheduledMessage.spec.ts`.
