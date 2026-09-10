# Chat composer in the transcript, images, headless tests — progress tracker

Released as **1.7.0**.

## What was asked

A text box in the transcript so you can chat with Claude without dropping to the terminal, in the
manner of the VS Code Claude extension. The stated gap in the terminal experience: pasting images,
seeing a small preview, and clicking one to enlarge it. Model/effort pickers "if easy".

Mid-flight addition: make the e2e suite headless, and default to it — a run made the machine
unusable for minutes at a time.

## Decisions taken with the user

- **The composer types into the live session.** Not a second conversation via the API: the message
  is delivered into the same `claude --resume` pty the Session tab shows. One source of truth (the
  session's own JSONL), no API key, and the transcript keeps being a faithful record rather than
  something the composer has to keep in step with.
- **Sending resumes a stopped session first**, rather than making you find the Resume button.
- **Pasted images are written to Apiary's own data directory** and the message carries their
  absolute paths, which is how Claude gets to read them. Never into the session's repository.
- **Images render throughout the transcript**, not just in the composer.

## Notes worth keeping

**Bracketed paste is the delivery mechanism.** `AppService.sendPrompt` wraps the text in
`ESC[200~ … ESC[201~` and follows it with a carriage return. Without the markers a multi-line
message submits at its first newline, sending a fragment and leaving the remainder to be read as
fresh prompts. There is an integration test that sends a two-line prompt into a **real shell pty**
and asserts both lines ran — so the mechanism is proven against a real terminal program.
**Still worth confirming by hand against the real `claude` TUI**, which is the one consumer the
test suite cannot stand up.

**`readImage` is a trust boundary, not a convenience.** The renderer supplies the path (it reads
them out of transcript text), so the main process resolves it and refuses anything outside its own
images directory — an unconstrained "read this file as a data URL" handed to the renderer would be
a way to exfiltrate any file the app can see. Tested, including a `..` climb.

**Previews must be data URLs, not object URLs.** The renderer is served from `file://` and the CSP
allows `img-src 'self' data:`. A `blob:` preview is silently blocked and renders as a zero-size
box — which is how the test caught it. Widening the CSP was the alternative; not taking it.

## The headless work, and the two races it exposed

Headless is `APIARY_HEADLESS=1`: the window is simply never shown (it was already created hidden
and revealed on `ready-to-show`). `backgroundThrottling: false` is set alongside it, because
Chromium throttles timers and stops servicing `requestAnimationFrame` in a window that is never
displayed — and the terminal fits itself in a rAF, as does the transcript's scroll. Tests default
to it; `APIARY_HEADED=1` to watch a run. `npm run screenshot` forces headed, since pixels are its
entire output.

Making the suite faster surfaced two pre-existing races that headed runs had been hiding:

1. **A real app bug.** UI state (selected session, sidebar width, pins) lives in localStorage, and
   Chromium commits that to disk on a batching timer rather than on write. Quitting soon after a
   change dropped it — you would come back having lost which session you had open. The app now
   calls `session.defaultSession.flushStorageData()` in its `before-quit` handler. That is a fix
   for users, not for tests.
2. **A test bug.** Filtering the sidebar is a round trip to the main process, so the list is
   briefly empty on the way to being narrowed; counting it the instant `fill()` resolved caught
   that gap. Polls now.

`relaunchApiary` also waits for the renderer to stop writing before killing it: the persist effect
runs *after* the render a test waits on, so "the title is on screen" does not yet mean "the
selection has been recorded".

## Environment gotchas (bite every time)

- `ELECTRON_RUN_AS_NODE=1` is exported here and breaks every Electron launch:
  `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`.
- `npm test` rebuilds native modules for **Node's** ABI; e2e needs **Electron's**. Whichever ran
  last wins. **Do not run `npm test` while a Playwright run is in flight** — it flips the ABI
  underneath it and every launch after that point fails for no visible reason.
- `npx playwright test` does not rebuild; `npm run build` first.

Final state: typecheck clean, `npm test` 159 passed, e2e 121 passed.
