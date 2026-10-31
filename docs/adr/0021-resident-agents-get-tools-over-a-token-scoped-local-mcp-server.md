# ADR-0021: Resident agents get Apiary's tools over a token-scoped local MCP server

- **Status:** Accepted
- **Context:** Resident agents (Regent first, more kinds later) are long-lived `claude` processes
  that must act in Apiary (find and read sessions, open a tab, keep notes) with only the Apiary
  tools their kind allows, and without a filesystem path ever coming from the agent.
- **Decision:** Main runs one hand-rolled JSON-RPC MCP server over `node:http` on `127.0.0.1:0`
  (`src/main/residents/mcp/`). Each resident has its own random 32-byte bearer token, written with
  the URL to `<space>/mcp.json` (mode 0600) and passed as `--mcp-config`, which adds Apiary's server
  to the user's own; `--allowedTools mcp__apiary__*` lets Apiary's tools run without asking. The
  token names the resident, and its kind's capabilities decide which Apiary tools it lists and may
  call.
- **Alternatives tried:** A stdio MCP shim that connects back to main over a socket: a second
  process per resident and a second channel to secure, for what one loopback HTTP server does.
  The official MCP SDK: a new dependency and audit surface for four methods (initialize,
  tools/list, tools/call, notifications) answered as plain JSON with no SSE.
- **Consequences:** A new kind is an entry in `kinds.ts` plus its tools in `src/main/residents/mcp/tools.ts`; the
  server, the service and the renderer do not change. The server checks `Host` (403) and the token
  in constant time (401), caps a body at 1 MB, and validates every argument before a handler runs.
  Never put the token on the command line.
- **Consequences (full tools):** Residents first ran with `--strict-mcp-config --tools ""`: Apiary's
  tools and nothing else, so Regent could not read an MR from GitLab or search the web. They now
  have the user's full tool set (the default tools, the user's settings, MCP servers, skills and
  plugins) behind chat mode's permissions: `--permission-mode <config.permissionMode>` (`auto` by
  default) and `--permission-prompt-tool stdio`. A tool use that needs the user's OK reaches the
  resident's status as a `ResidentPermissionRequest` and is answered with `residentPermissionAnswer`,
  in the reply chat mode sends (`permissionReply` in `src/main/chat/protocol.ts`). The capabilities
  still scope Apiary's own tools; they no longer bound what a resident can do on the machine.
- **Enforced by:** `tests/integration/residents/mcpServer.test.ts` (bad token, foreign Host, scoped
  tool list, out-of-capability call, 2 MB body); `tests/integration/residents/residentService.test.ts`
  (the launch line); `tests/unit/architecture/claudeStartsWithAccount.test.ts`.
