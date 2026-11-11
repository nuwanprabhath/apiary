# Resident agents

Always-on `claude` agents the user configures in the `residents` setting (one `ResidentConfig`
each: name, kind, enabled, models, schedule, usage pause, permission mode, digest lookback and the
kind's own `options`). Regent is the first kind; the MR desk is the second.

## Kinds and capabilities

- A kind is one entry in `builtinKinds` (`kinds.ts`). Adding a kind is that entry plus any
  new tools in `mcp/tools.ts`; `residentService.ts`, `mcp/server.ts` and the renderer never name a
  kind. Its fields:
  - `defaults`, `blurb`, `appearance`, `systemPrompt`, `digests`;
  - `capabilities`: the Apiary tool groups (`ResidentCapability`) it may use;
  - `optionFields`: its own settings (`text` or `folder`), stored in `config.options` by key;
  - `quickActions`: right-click actions, each a `prompt` (sent to its chat as if typed) or a
    `command` (an argv run by main, its output added to the chat as an assistant message, no model);
  - `bins`: what `{bin:<name>}` in a command's argv expands to (an argv prefix);
  - `cycle?`: a prompt sent every `everyMinutes`, or the resident's `cycleEveryMinutes` (5, 10,
    15, 30 or 60; null is the kind's). The quick action id `cycle` (`CYCLE_ACTION_ID`, Settings'
    Check now) sends it at once. `status.cycle` (`cycle.ts`) says the interval, the next one and
    whether the running turn is one; `apiary_status` says the same;
  - `instantMatches`: whether a send answers with the index's matches. Even then
    `instantMatchPolicy` (`instantMatches.ts`) shows them only for a lookup: `ref` hits for a
    message naming a ref, the top three for one asking to find or open a session, none otherwise;
  - `setup(config)`: what is missing before it can work, or null (`status.setupNeeded`);
  - `toolPolicy?`: `disallowedTools`, passed as `--disallowedTools` in every permission mode (the MR
    desk: `glab mr approve|note|merge|close`, `glab api`, `git push`);
  - `approval?`: how `approve_mr` (capability `gitlab.approve`) reads and approves an MR;
  - `userActions?`: how `request_user_action` (same capability) reads, shows and runs a write;
  - `pathFirst?(space)`: a folder its claude's Bash tool finds commands in first (below);
  - `env?(config, space)`: extra environment for its claude and its commands;
  - `prepare?(config, space)`: async, writes what its program reads and probes its tools.
- A kind id is a branded slug (`ResidentKindId`, `isResidentKindId`); the built-ins are
  `REGENT_KIND` and `MR_DESK_KIND`. Which ids exist is a `KindRegistry` (`kinds.ts`), filled from
  `builtinKinds`. The settings guard accepts any well-formed id; `ResidentService` does not run a
  resident whose kind the registry lacks (`unknownKindFilter`) and logs the id once.
- `kindInfos()` is what the renderer sees of a kind (`residentKinds`), derived from `builtinKinds`
  plus the data kinds the container passed to `showDataKinds`.
- **A user's kind is data, never code** (ADR-0022). `userData/resident-kinds/<id>/kind.json` plus an
  optional PROMPT.md, read once at start by `readManifestKinds` (`kinds/manifestKind.ts`); no file
  watching. `validateResidentKindManifest` (`src/shared/residentKindManifest.ts`) is the only way
  in: name, blurb, appearance, capabilities (not `gitlab.approve`), `text` option fields, `prompt`
  quick actions, a cycle and a `toolPolicy`; never commands, `bins`, `env`, `prepare` or `digests`,
  and never a built-in's id. `manifestKind` gives it `setup: () => null`, no bins, a `manual`
  permission mode and Apiary's preamble before the author's prompt. A refused folder is logged by
  name and reason.
- Each tool in `APIARY_TOOLS` carries its capability, a JSON schema for tools/list and a guard
  that checks the arguments before the handler runs. `toolsFor(capabilities)` is what a resident sees.
- No tool takes a path. A session id from the agent is checked against the session store; an
  unknown one is an error result (`isError`), never a throw. The status and attention tools act on
  the resident the token names, through `ToolDeps.residents` (`ResidentControl`).

## Tokens, and why MCP over HTTP

- `mcp/server.ts` is one JSON-RPC server on `127.0.0.1:0`, started when the first resident starts.
  Each resident gets a random 32-byte bearer token; the token names the resident, and its kind's
  capabilities scope tools/list and tools/call. `Host` must be `127.0.0.1:<port>` or
  `localhost:<port>` (403), the token is compared in constant time (401), a body is capped at 1 MB.
- The token and URL live in `<space>/mcp.json` (mode 0600), passed with `--mcp-config`, so they
  never show in `ps`. Why HTTP and not a stdio shim or the MCP SDK:
  [ADR-0021](../../../docs/adr/0021-resident-agents-get-tools-over-a-token-scoped-local-mcp-server.md).

## The space

`userData/residents/<id>/`, mode 0700, owned by `residentSpace.ts`: history.json (the visible
chat, last 500 messages), state.json (the claude session id and the attention), notes.json (the
`note_*` tools, keys ≤ 80, text ≤ 4000, ≤ 500 keys), mcp.json. It is also the claude's cwd and the
cwd of its quick-action commands.

## The schedule and cycles

`shared/residentSchedule.ts` is pure. An end at or before the start crosses midnight and belongs to the start's
day; no days means never on duty. The service keeps one timer at the earliest `nextChange`, idle
stop or cycle, capped at a 5-minute re-check so a sleep and wake cannot leave it stale.

A kind's `cycle` prompt is first due `everyMinutes` after the resident comes on duty. When due,
`cycleSkip` (`quickActions.ts`, pure) gates it: off duty or disabled resets it; a running turn or a
waiting permission retries a minute later; `setupNeeded` skips a whole cycle. Each skip is logged.

## The chat process

- `residentChat.ts`: one stream-json `claude` per resident through `spawnLoginShell`, under the
  default account's `launchEnv` plus the kind's `env`, with `--resume` and the stored session id.
- **Full tools, chat-mode permissions.** It runs as a normal session: the default tools, the user's
  settings, MCP servers, skills and plugins, Apiary's server added with `--mcp-config` and allowed
  with `--allowedTools mcp__apiary__*`, `--permission-mode <config.permissionMode>` and
  `--permission-prompt-tool stdio`. A `can_use_tool` request becomes a `ResidentPermissionRequest`
  (`permissionSummary` in `activity.ts`: "Run: <command>" cut at 120, "Edit <file name>", or the
  tool's name) until `residentPermissionAnswer` replies with chat mode's `permissionReply`, a
  `control_cancel_request` drops it, or the process exits.
- It starts on the first send or on going on duty (warm); off duty it stops after 20 minutes idle,
  and it stops when disabled and on quit. A change of model, name, permission mode or options
  restarts it once idle. A death mid-turn adds "‹name› stopped unexpectedly: …".
- Activity comes from every tool use (`activity.ts`, pure, 40 characters: "Running mra prompt
  1559", "Helper: …", "Reading docs.gitlab.com", "Using <server>", "Working" for one it does
  not know), from a thinking block ("Thinking") and streamed text ("Writing"), or from
  `set_activity` until the next tool call or the turn's end. The status is `asleep` (disabled, or
  off duty with no turn), `working` (a turn, background tasks or the digest), or `idle`; `statusOf` is the one place
  that makes a `working` status say "Working" rather than null.
- **A turn can start with nothing sent.** Claude Code runs Agent subagents and `run_in_background`
  Bash in the background: the turn ends ("I'll post when it finishes") and, when the task ends,
  claude starts a turn of its own. Output with no turn open (a `stream_event` or an `assistant`
  message without `parent_tool_use_id`) opens one, as `send` does, so its answer is saved and
  pushed. When such a turn ends with text and the resident neither set nor cleared attention during
  it (`ResidentSpace.attentionWrites`), it sets `NEW_UPDATE` (`{ count: 1, summary: 'New update' }`).
  `residentMessage` is broadcast to every window, so which windows have the popup open changes nothing.
- **Background tasks keep it working.** `system`/`background_tasks_changed` (parsed by chat mode's
  `backgroundTasksOf`) is kept until the next list or the process's exit. While it names tasks and no
  turn runs, `working` is true and the activity is the one task's description, or "Waiting on N
  background tasks"; `apiary_status` lists them. `busy` stays a running turn only, so a cycle that
  comes due alongside background tasks still goes: claude takes a message then.

## Attention and quick actions

- `attention` is what a resident needs the user for: `set_attention`/`clear_attention` write it to
  state.json, so it survives a restart, and `residentSeen` (the popup opening) clears it. While a
  permission request waits, the status shows `{ count, summary: 'Waiting for your OK' }` instead.
- The renderer adds the common actions (open chat, settings, pause); `status.quickActions` lists only
  the kind's. A command's argv is expanded by `expandArgv` (`{option:<key>}` inside an argument,
  `{bin:<name>}` as a whole one), run with `createExec` (60 s, execFile, no shell) in the space with
  the resident's env; its stdout, or "**label** failed: …", is appended as an assistant message.
- A folder option is never a path from the renderer: `residentPickFolder` opens main's dialog and
  the service stores the choice (`setFolderOption`), for a key whose field is `input: 'folder'` only.

## MR desk (`src/main/residents/kinds/mrDesk.ts`)

The second kind runs **mra**, the maintainer's gitlab-mr-agent, vendored in
`resources/residents/mra/` (Python 3, standard library, MIT; its `README.md` lists where it came from
and what changed). Apiary is its home; `npm run test:mra` runs its tests. `kinds.ts` builds the kinds
with `KindDeps` (`src/main/residents/kinds/kindDeps.ts`: `resourceDir(kindId)`, `exec`, `searchPath`, and `files`, whose real implementation is `kinds/kindHost.ts`, so `kinds.ts` imports no Node module the renderer fake cannot load) so a test or the container
passes the outside world in; `src/main/app/resourcesDir.ts` is the one resolver (`process.resourcesPath` when
packaged, `<repo>/resources` in dev; `electron-builder.yml` `extraResources`).

- **Config and state live in the space.** `prepare` (a kind hook the service runs when the resident is
  first seen, when its options change (again as soon as a run ends, for options saved during it) and on each re-check while `setup` still reports something;
  claude and quick-action commands wait for it) writes `<space>/mra/config.json` from the options
  (`project`, `repo_path`, `username` only when set, `active_hours: null`: Apiary's schedule gates
  cycles, so mra never goes quiet on its own) through `writeJsonAtomic`. It is a file for another
  program, not app state, so it is not a `JsonStore` and not listed in `tests/unit/architecture/persistedStores.test.ts` (which covers userData files Apiary reads back). `env` sets
  `MRA_CONFIG`, `MRA_STATE_DIR=<space>/mra/state` and a `PATH` that starts with `<space>/bin`.
- **The wrapper.** `<space>/bin/mra` (mode 0700, `writeExecutableText`) is `exec python3 '<mra dir>/bin/mra' "$@"`,
  so the prompt's `mra …` commands run as written in the resident's Bash tool. `bins.mra` is the same
  argv for quick actions.
- **The project may be a URL.** `parseGitlabProject` (`kinds/mrDeskProject.ts`) reads a GitLab
  project URL (with `.git`, a trailing slash or a `/-/…` page) as its path plus mra's
  `gitlab_host`, when `<space>/mra/config.json` is written; the setting stays as the user typed
  it. What it cannot read, `setup` reports.
- **`setup` gates cycles.** In order: project (set, then readable), clone, `python3` (`python3 --version`), `glab`
  (`glab auth status`). The two binaries are probed by `ToolProbe` through `createExec`, not on every
  status; "Invalidated by" `prepare`. Until the first probe nothing is reported missing.
- **Approval needs a click.** The agent cannot approve from its shell: `glab` writes are disallowed
  and `mra approve` refuses without `MRA_APPROVE_NONCE` equal to `<space>/mra/state/approve.nonce`.
  `approve_mr({ iid })` (`mcp/tools.ts`) has main run `mra ready !<iid>`, show a permission card
  ("Approve !1570: title → target at <sha>", from GitLab, never from the agent's words) through
  `ResidentChat.askUser`, and only on Allow write the nonce, run `mra approve !<iid>` with it and
  delete it. A denial, or the chat stopping, approves nothing.
- **Its `mra` comes first on the Bash tool's PATH.** Claude Code's Bash tool runs in a snapshot of
  the login shell, whose profile may prepend the user's own bin folder holding an older personal `mra`, so
  `env().PATH` alone lost. `pathFirst` makes `prepare` write `<space>/claude-settings.json` (0600,
  `pathFirstSettings` in `claudeSettings.ts`: a SessionStart hook appending a PATH export to
  `$CLAUDE_ENV_FILE`, which is sourced before every Bash command) and `residentLaunch.ts` passes
  `--settings`. `apiary_status` lists the mode, allowed and disallowed tools claude was started with.
- **Prompt and CLI cannot drift.** `prepare` runs `python3 <mra> --help`; a `` `mra <sub>` `` the
  prompt names that it lacks is logged and `setup` says "mra is missing: …".
  `tests/unit/residents/mrDeskActions.test.ts` checks the prompt against the vendored parser.
- **Blocks explain themselves.** `MR_DESK_BLOCKED` (`kinds/mrDeskMra.ts`) is one table: the
  disallowed tools and the preamble's "blocked → use instead" lines are both made from it.
- **Publish, reply, resolve need a click.** Drafts (`mra draft add|list|edit|move|delete`) are free.
  `request_user_action({ kind: publish_drafts | reply | resolve, iid, discussionId?, body? })`
  (`mcp/gitlabTools.ts`, kind side `kinds/mrDeskActions.ts`) has main run `mra ready` plus
  `mra draft list` or `mra thread`, build the card from their output (the reply body, shown verbatim,
  is the only agent text), and only on Allow write `<space>/mra/state/action.nonce`, run the write
  with `MRA_ACTION_NONCE` (a reply's body through `--body-file`), and delete both files. `approve_mr`
  uses the same `runWithNonce`.
- **Untrusted text.** `mra prompt` wraps the MR title and comment bodies in `<<<UNTRUSTED` … `>>>`
  and opens the prompt saying that text is data. The residual risk: an agent with a shell can still
  reach `glab` through another program; a read-only GitLab token for the resident would close it.
- **The prompt** is a short preamble from code plus the vendored `resources/residents/mra/RESIDENT.md` (the upstream skill, adapted), read when
  claude starts. The cycle ends with `set_attention` / `clear_attention`, and `set_activity` while it
  works. The hard rules (never post, approve only when named, resolve only the user's threads, no CI,
  no push, no attribution) are kept word for word; `tests/unit/residents/mrDesk.test.ts` checks them.

## Knowledge and digest

`SessionKnowledge` and `DigestJob` (`main/knowledge/types.ts`) are injected; `createResidents` passes
the knowledge index and its digester (`app/knowledgeContainer.ts`). Both are typed `| null` so a test
can run the service without an index: then the knowledge tools answer `NO_INDEX`, the digest is a
no-op and the status's `digest` is null. The service calls `resume` on every re-check while on duty,
so a digest pass that reached the end of its queue picks up sessions that changed since. The
driving resident's `digestLookback` goes with `resume`: a pass queues only sessions last active
inside it (`lookbackStart`, months of 30 days, null for all), and progress counts only those. A
change applies from the next pass; nothing is re-digested. `apiary_status` reports the progress,
the lookback and `indexSize()`.
