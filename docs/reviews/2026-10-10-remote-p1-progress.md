# Remote access (phases 1 to 3): progress ledger

Design: `docs/proposals/2026-10-10-remote-access.md`.

The maintainer's decisions (2026-10-10):

1. remote windows are copies;
2. SSH alone, with the pairing code optional;
3. discovery from `~/.ssh/config`, recent hosts and Tailscale;
4. the home machine's look with the work machine's data;
5. the work app must be running.

Branch `feature/remote-p1`. Agents: Sonnet at low effort, run with `scripts/agents/run-agent.sh`.
Briefs are in `.agent-reports/remote1/`.

| Package | What | Status |
| --- | --- | --- |
| Foundations (lead) | `src/main/remote/scopes.ts` (every channel classified), `protocol.ts`, `frames.ts` | merged |
| R1a | The work machine's server: one dispatcher, scope-typed handlers, virtual windows, the socket at `~/.apiary/remote.sock`, the `remoteAccess` setting | merged |
| R1b | The home machine's side: the connection, routing by scope, the bridge contract over the remote path | merged |
| R2a | ssh with socket forwarding, opening the remote window, the menu item, drop handling | merged (lead: login-shell `sshExec`) |
| R2b | The connect dialog, the remote badge, the disconnected banner, no pets | merged |
| R3 | The Docker SSH test bed: the image, the harness, MITM and forwarding tests, Apiary booting in the container | merged (lead: fixture copy, single-instance wait, JSON handshake) |
| R3b | End to end over real SSH: this Mac's Apiary to the container's | merged (14 Docker cases; lead: title and live-update assertions) |
| P2a | Every remote window; reconnect with backoff; replay attachments; the window catches up | merged (lead: an unreachable socket is retried) |
| P2b | Host discovery: recent, ssh config, Tailscale; probing; the Open Remote Session submenu; the dialog's host list | merged |
| P2c | Work machine: connected-clients indicator, Disconnect all; the optional pairing code (Keychain at home) | merged (lead: own composition file `remoteContainer.ts`) |
| P3a | Remote folder browser (names only, never paths, per ADR-0001) | merged (lead: no hover card over a modal, audit rule popup-over-modal) |
| P3b | Open in VS Code over SSH (`code --remote ssh-remote+HOST`) | merged |
| P3c | Start Apiary on the work machine when it is not running (`open -g -a Apiary --args --background` on macOS) | merged (lead: the offer replaces the contradicting error) |

The maintainer asked for all phases in one release (2026-10-10).

Lead notes:

- The packaged app has `runAsNode` off (SEC-3), so the work machine cannot run a bridge script with
  Apiary's own Node. The home machine instead uses OpenSSH's Unix-socket forwarding (`ssh -N -L`),
  which sshd allows by default. Tailscale SSH support for socket forwarding is unverified.
- Reviewing R1a found a gate weakness: overlap counted the parts of a row its scrolling list hides.
  Fixed in `audit.ts` (a7817f4).
- The handshake is JSON (frames.ts): V8's format changes between Electron versions, so two Apiary
  versions could not have read each other's refusal. Found by the Docker bed.
- The disk filled (ENOSPC) during the run: the Docker test bed left a 4 GB image and its build
  cache per rebuild. Two agents died; Docker Desktop hung and was force-quit. The bed now refuses to
  build below 15 GB free and prunes only its own labelled leftovers.
- P3c adds a single-instance lock (a second launch focuses the first, or with `--background` exits
  quietly). The full e2e run, including relaunch and multi-window, gates the release.
