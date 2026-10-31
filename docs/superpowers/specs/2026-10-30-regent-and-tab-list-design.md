# Regent (resident agents) and the tab list — design

Release: one version, **1.49.0**. Two changes:

1. A tab-list button at the end of each pane's tab bar.
2. **Resident agents**: always-on agents that live in Apiary. The first one is **Regent**, a chief of staff
   that knows every Claude session and opens or answers from them. The user can rename it.

Decisions made with the maintainer (2026-10-30):

- **Digests cover everything.** The whole history is digested in the background, newest first, then
  kept up to date.
- **The engine is the Claude CLI.** It runs on the logged-in account and gets Apiary's tools over a
  local MCP server.
- **Outside the schedule, Regent is summonable but idle.** It does no background work, but the chat
  still answers.
- **A found session opens in the focused pane.** If it is already open anywhere, Apiary jumps to that
  tab. Several matches become clickable options in the chat.

---

## 1. Tab list

- **Button.** The last item of the tab strip wrapper sits after the right scroll arrow and before the
  split button: an icon button `session-tab-list` with a list/chevron-down glyph. It shows when the
  pane has 2 or more tabs. Like the arrows, the existing `@container (max-width:140px)` rule hides it.
- **Menu.** Clicking opens a popover anchored to the button. It has one row per tab in this pane, in
  tab order. Each row shows:
  - the busy/status dot that tab shows;
  - the title, ellipsized with a `title` tooltip;
  - the folder or branch hint, muted;
  - an active-row mark.
- **Choosing.** Click or Enter selects the tab, scrolls it into view in the strip and closes the menu.
- **Reorder.** Rows are draggable. A drop line shows where the row will land, and dropping
  dispatches the same reducer action as dragging a tab in the strip (`moveTabToColumn` with the same
  column and a new index). With the keyboard, Alt+ArrowUp/Down moves the highlighted row.
- **Filter.** A type-to-filter field appears at the top when there are more than 8 tabs. Reordering
  is disabled while a filter is active.
- **Closing.** Escape, an outside click or a selection closes the menu. Focus returns to the button.
- **Tests:** component tests for listing, selecting, drag reorder, keyboard reorder and filter, plus a
  UI scenario with 12 tabs, the menu open and one row mid-drag.

---

## 2. Resident agents

### 2.1 Concepts

- **Resident kind.** A definition shipped in code, of which `regent` is the first. A kind declares:
  - its defaults (name, model, schedule);
  - the **capabilities** (tool groups) it may use;
  - its system prompt;
  - its background jobs;
  - its **appearance**, chosen from closed sets the renderer knows how to draw: a glyph (`bee`), a
    palette (`gold`) and an animation (`halo`).

  As with status-bar plugins, only data crosses to the renderer.
- **Resident.** A configured instance of a kind. It has its own id, name, enabled flag, schedule,
  model and **space**: a private folder at `userData/residents/<id>/` holding its chat history, its
  notes and its CLI working directory. The design allows several kinds and several instances. For
  now the settings UI offers to add Regent only.
- **Apiary tools.** One in-process **MCP server** on 127.0.0.1 with a random port, speaking
  JSON-RPC over HTTP with JSON responses (no SSE), hand-rolled to avoid a new dependency and its
  audit surface.
  - Each resident gets its own random bearer token. The token decides the capabilities, so a
    future GitLab-MR resident sees only its own tools.
  - The server checks the `Host` header to block DNS rebinding.
  - Tools take ids, never filesystem paths.

### 2.2 Main process layout

#### `src/main/residents/`

- `kinds.ts`: `ResidentKind` and `BUILTIN_RESIDENT_KINDS` (Regent). This is the only place a new
  kind is added.
- `schedule.ts`: pure. `isActive(schedule, now)` and `nextChange(schedule, now)`. Days 0–6 and
  `HH:MM` start/end in local time; end ≤ start means the window crosses midnight.
- `residentService.ts`: starts and stops each enabled resident.
  - On a timer at the schedule boundaries, it starts or pauses background jobs.
  - It owns each resident's status `{ state: 'asleep'|'idle'|'working', activity?: string }` and
    pushes it with the `residentsChanged` event.
  - It routes chat send, stop and clear.
- `residentChat.ts`: one long-lived `claude` stream-json process per resident.
  - Started on the first message, or at the schedule start while active.
  - Stopped after 20 minutes idle outside active hours.
  - Launch line: `--model <model>`, `--mcp-config <space>/mcp.json` (mode 0600, holds the
    token), `--strict-mcp-config`, `--tools ""`, `--allowedTools mcp__apiary__*`,
    `--append-system-prompt <kind prompt>`, cwd = the space, and the account's launch env.
  - Continuity uses `--resume <sid>` from the stored session id.
  - The visible history lives in `<space>/history.json` (max 500 messages). "Clear history"
    empties it and forgets the sid.
  - It reuses `ChatSession`'s stream-json parsing where it fits; the tool-call events feed the
    activity text.
  - **Probe first.** Confirm that MCP tools work with `--tools ""` (and without `--safe-mode`).
    If they don't, use `--tools` with an empty allowlist plus `--allowedTools`.
- `activity.ts`: pure. Maps a tool call to a few words: `find_sessions` → "Searching sessions",
  `read_session` → "Reading ‹title›", `open_session` → "Opening ‹title›", and while text streams,
  "Thinking". The digester reports "Digesting 12/840".

#### `src/main/residents/mcp/`

- `server.ts`: the HTTP JSON-RPC server, handling `initialize`, `tools/list` and `tools/call`.
- `tools.ts`: the tool registry. Each tool has a name, a capability, a JSON schema and a handler.

#### Tools, v1

| Tool | Capability | What it does |
| --- | --- | --- |
| `find_sessions(query, limit≤20)` | sessions.read | Ranked hits from: exact refs (!1175, #123, ABC-123, MR/issue/Jira URLs), topic-digest FTS, transcript FTS, titles/branches/folders. Returns id, title, folder, branch, last active, matched topics with a snippet, and a match reason. |
| `session_topics(sessionId)` | sessions.read | The session's digest: topics with summary, refs and line range. |
| `read_session(sessionId, topicId?, query?, maxChars≤20000)` | sessions.read | User and assistant text around a topic or the query hits, or the tail. |
| `open_session(sessionId)` | workspace.open | Focuses the tab if it is open in any window; otherwise opens it in the focused window's focused pane. |
| `list_open_tabs()` | workspace.read | Sessions open in each window and pane, and which one is focused. |
| `note_get(key)` / `note_put(key, text)` / `note_list()` | space.notes | The resident's own key-value notes (a JSON file in its space), e.g. aliases the user teaches it. |

**Citations.** Answers link sessions as `apiary://session/<id>`. The renderer turns those links into
session chips that open the session on click.

### 2.3 The knowledge index

The index lives in `src/main/knowledge/`, owned by Apiary rather than by Regent, so later
residents can use it.

- **Refs** are deterministic, cheap and rebuildable.
  - `refs.ts` is pure: it extracts MR refs (`!123`), issues (`#123`), ticket keys (`[A-Z][A-Z0-9]+-\d+`),
    and GitLab/GitHub/Jira URLs normalised to (host, project, kind, number).
  - The existing indexer pass calls it and writes a `refs(session_id, kind, value)` table in the
    search DB.
  - `find_sessions` resolves a pasted URL to the same normalised ref.
- **Topic digests** are expensive, so they live in a separate DB, `userData/knowledge.db`, which a
  search-index rebuild does not delete.
  - `topics` is an FTS5 table: session_id, topic_id, title, summary, keywords, refs, start_line,
    end_line. `digested(session_id, last_line, size, model, at)` records progress.
  - Incremental: only lines after `last_line` are digested.
- **The digester** (`digester.ts`) is a job of the Regent kind. It runs only inside active hours,
  one session at a time.
  - Queue order is newest first, so the whole history is covered eventually.
  - It cuts the transcript text into windows of about 40k characters (user and assistant text, tool
    names only) and asks the digest model (default `haiku`, via `ClaudeOneShot` with
    `--no-session-persistence`) for JSON topics. It validates the JSON and drops any topic with no
    title.
  - Regent's own space folder is excluded, so Regent never indexes itself.
  - It **pauses** when the 5-hour usage is at or above the setting (default 70%). The usage figure
    comes from the usage plugin when consent was given; without it there is no pause.
  - It retries a failed session no more than once a day.
  - Progress is reported as the resident's activity.

### 2.4 Speed

- **Instant matches.** The moment the user sends, Apiary runs `find_sessions` locally (no model)
  and shows up to 3 candidate cards in the chat, each one click to open. The model's answer follows.
  A request with an exact ref (!1175) and a single hit therefore resolves in about 50 ms.
- **A warm process.** During active hours the CLI process is started in advance.
- **Ask Regent from the search box.** In the sidebar search, ⌘↵ (Ctrl+Enter on Linux) sends the
  query to Regent and opens its popup.
- **Global summon shortcut.** ⌘⇧Space toggles the popup in the focused window. It is configurable.

### 2.5 Settings

The schema gains `residents: ResidentConfig[]`:

```ts
interface ResidentConfig {
  id: string                 // 'regent' for the first one
  kind: 'regent'
  name: string               // default 'Regent', 1..40 chars
  enabled: boolean           // default false
  model: string              // chat model alias, default 'sonnet'
  digestModel: string        // default 'haiku'
  schedule: { days: number[]; start: string; end: string } // default Mon–Fri 09:00–18:00
  pauseAboveUsagePercent: number // default 70, 0 = never pause
}
```

- A **Residents** settings section lists them. Each card has name (rename), enable, model, digest
  model, schedule (day chips plus two time fields), the usage pause and the digest progress
  ("612 of 840 sessions digested"). It also has two actions: **Clear history** and **Re-digest
  everything** (with a confirmation).

### 2.6 The status bar and the bee

- **A resident slot** sits left of the plugin items, so Regent appears to the left of Claude usage.
- **Each resident is drawn from its appearance.** For Regent that is a round bee glyph (SVG: striped
  body, wings) in a golden halo built from conic gradients that rotate on `@property` angles, like
  Siri.
  - **asleep**: dim, no glow, a small "z" dot.
  - **idle**: a slow breathing glow every 4 s.
  - **working**: the halo swirls faster, the wings flutter, and the circle grows into a **pill** that
    shows the activity words (max 28 characters, then ellipsis, with the full text as a tooltip). The
    width animates, and the status bar's min-height rises by about 6px while any pill is open.
  - **unread answer** (popup closed): a gold dot.
  - Reduced motion gives a still frame for every state.
- **Clicking** toggles the popup.

### 2.7 The popup

- **Window behaviour.** A floating panel in the window it was summoned from. It can be dragged by
  its header and resized from its edges and corner (min 320×280). Its position and size persist in
  `uiState`. It stays open until the X is clicked: no outside-click or Escape close.
- **Header.** Name, state and activity, Clear history, Stop (while working) and X.
- **Body.**
  - The chat history, restored from main on open and shared across windows.
  - Markdown, using the chat message renderer.
  - Session chips for `apiary://session/` links.
  - Instant-match cards.
  - The working line, using the user's busy animation.
- **Input.** Enter sends; Shift+Enter adds a newline. The composer keeps its draft in `uiState`.
- **When disabled.** If the resident is not enabled, the popup offers an "Enable in Settings" button
  instead of the chat.

### 2.8 IPC (contract.ts)

All channels are local-only; remote scopes exclude them for v1.

- `residentsList(): ResidentStatus[]` and the `residentsChanged` event.
- `residentHistory(id): ResidentMessage[]` and the `residentMessage` event (streamed deltas).
- `residentSend(id, text)`, `residentStop(id)`, `residentClear(id)`.
- `residentInstantMatches(id, text): SessionHit[]`.
- `residentRedigest(id)`.
- `openSessionRequested` event `[sessionId]` (main → focused window). The renderer opens or focuses
  the tab through the workspace store's existing open path.

### 2.9 Testing

- Unit tests:
  - `schedule` (overnight, weekend, boundaries) and `refs` (all forms, URLs).
  - `activity`, the digest JSON validation, MCP JSON-RPC (auth, Host check, capability filtering,
    errors) and `find_sessions` ranking.
- Integration:
  - the knowledge DB with a fixture transcript and a fake digest model;
  - the MCP server over real HTTP;
  - a real-CLI probe test, skipped when there is no `claude` binary.
- Component tests: the status-bar bee in each state (pill growth), and the popup (send, history,
  drag/resize persistence, chips open a session, stays open on Escape).
- UI scenarios: the bee in asleep, idle and working-with-pill; the popup with history and chips; the
  Residents settings section.
- Contract clauses for every new channel on the fake and real main.
- One e2e test: enable Regent with a fake CLI binary and check that a question returns a chip that
  opens the session.

### 2.10 Docs

- `src/main/residents/CLAUDE.md` and `src/main/knowledge/CLAUDE.md`, plus root map rows.
- An ADR: "Resident agents get Apiary's tools over a token-scoped local MCP server".

### 2.11 Later (not in 1.49)

- A morning brief at the start of the schedule: what changed yesterday, and which sessions are
  waiting on you.
- The gitlab-mr-agent as a second kind, with an `mr.*` capability group.
- Remote access to residents.
- Embeddings for semantic recall, if FTS over the digests proves too literal.
