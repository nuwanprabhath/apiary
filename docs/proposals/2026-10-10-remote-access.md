# Remote access: feasibility (proposal, not built)

The maintainer's request: Apiary runs on a work machine reachable from home over Tailscale (plain SSH
works). At home, File → New Window → **Open Remote Session** lists hosts that have Apiary remote
access enabled. Choosing one opens a local window for each of that machine's Apiary windows, each
titled with the host, and they work as the local app does: sessions, open tabs, transcripts, chat
and terminals. Pets are not needed. Man-in-the-middle attacks must not be possible.

**Verdict: feasible, with no rewrite.** It is a large feature: about the size of the 1.35 release
for a first usable version, and the same again for the full request. The app's architecture already
has the seam it needs.

## Why it fits this codebase

- **Everything the UI does crosses one declared contract.** `src/shared/ipc/contract.ts` declares
  148 channels: 105 invoke, 14 send, 22 events, plus 4 loose invokes, 1 loose send, 1 sync and 1
  local call. Each has a runtime guard on its arguments. The preload is generated from it, and
  components never touch anything else (`bridge-via-state`).
- **The main process already runs without Electron IPC.** `tests/integration/contract.test.ts`
  drives the real preload and the real main handlers through an in-process loopback, where every
  argument and result goes through `structuredClone`, as it would on a wire. A network transport is
  the same idea across a socket.
- **The renderer never supplies a path main acts on** (ADR-0001), and main validates every argument.
  The trust boundary that makes the local app safe is the one a remote client needs.
- **A pty belongs to main, and a late view gets a snapshot.** Terminals keep running on the work
  machine when home disconnects, and a home window can attach to a running terminal, as a second
  local window already can.

## Proposed design (VS Code Remote-SSH's shape)

```text
home Apiary window ── remote preload (same ApiaryApi) ── home main: RemoteClient
        │                                                   │ spawns: ssh -T <host> apiary-remote-bridge
        │                                                   ▼
        │                            (SSH: keys, known_hosts, Tailscale all as the user has them)
        ▼                                                   ▼
 local-only calls stay local                 work machine: bridge (stdio ↔ Unix socket)
 (spelling, clipboard, edit menu,                          ▼
  window chrome, theme)                      work Apiary main: RemoteServer → the same handlers
```

1. **Server (work machine).**
   - Settings → **Allow remote access** opens a Unix domain socket in the app's data folder:
     directory mode 0700, socket mode 0600. No TCP port is opened, ever.
   - It speaks length-prefixed JSON frames: `{id, channel, args}` → `{id, result | error}`, plus
     `{event, payload}`. The server runs each call through the contract's own guard and the
     existing handler.
   - Each connection is a **client** with its own virtual window ids. A remote window is an
     abstraction in main, not a `BrowserWindow`.
2. **Transport.**
   - Home runs `ssh -T -o BatchMode=yes <host> <bridge>`. The bridge is a small script shipped in
     the app bundle, run with the remote app's own Node (`ELECTRON_RUN_AS_NODE`). It pipes stdin and
     stdout to the socket.
   - Whatever the user's SSH already does applies: keys, agent, `~/.ssh/config`, Tailscale MagicDNS
     or Tailscale SSH.
3. **Client (home).**
   - A remote window loads the same renderer with a **remote preload**, generated from the same
     contract, that sends calls down the SSH stream instead of `ipcRenderer`. Every feature that
     goes through the contract therefore works remotely with no per-feature code.
   - Calls that must stay on the home machine stay local: spelling, the text menu and edit
     commands, the clipboard, window chrome and the menu, the theme, and notifications.

### Security

| Threat | Answer |
| --- | --- |
| Man in the middle | All traffic is inside SSH, and the host key is verified against `known_hosts` with `StrictHostKeyChecking=yes`. An unknown host key is refused, with its fingerprint shown and a "trust this host" step, as VS Code does. Apiary adds no TLS, certificate or crypto of its own: it reuses SSH's. |
| Someone else on the network | Nothing listens on the network: the socket is local to the work machine, and only someone who can already SSH in as that user can reach it. |
| Another user on the work machine | The socket and its folder are owned by the user, modes 0600 and 0700. |
| A compromised or rogue client | The server validates every argument with the contract's guards, and never takes a path from a client (ADR-0001). A remote client can do what the UI can do: run Claude and terminals, so in effect a shell. That is no more than the SSH login it came through already allows. |
| Forgotten exposure | Remote access is off by default. The work machine shows a "Connected from home-mac" indicator, logs connections, and has "Disconnect all". |
| Version mismatch | The handshake compares contract hashes and refuses a mismatch with "Update Apiary on work-box to 1.x". |
| Extra password | Optional. SSH already authenticates, but a pairing code (shown on the work machine, entered once at home, stored in the macOS Keychain) can be required on top. |

### Opening the remote's windows

- The server lists its windows and each window's layout (tabs, panes, the shell open or closed).
  Home opens one local window per remote window, seeded from that layout, titled "work-box — Apiary
  (remote)" and visibly marked as remote.
- Sessions, transcripts, chats, terminals and git state are live and shared. A message sent from
  home appears at work, and a terminal is the same pty.
- Discovery: the submenu lists hosts from `~/.ssh/config`, recently used hosts, and Tailscale peers
  (`tailscale status --json`, when Tailscale is installed). On hover, Apiary probes each in parallel
  (`ssh -o BatchMode=yes -o ConnectTimeout=3 <host>` with a socket check) and marks it ready, not
  enabled, or unreachable. "Connect to host…" takes any host by name.

### What needs real work

1. **Window-bound calls.** About 35 places in the main process's IPC layer, and 17 main files
   holding a `BrowserWindow` or `webContents`, assume the caller is a local Electron window: tabs,
   layouts, detach tab, focus, the title bar menu, restoring windows. They need a **client window**
   abstraction (a local window, or a remote client's virtual window) that sits behind the existing
   windows-and-tabs model. This is the main refactor.
2. **Native dialogs.** The folder picker is a native dialog, and on a remote machine it would open
   on the wrong screen. Phase 1 disables "import a folder" remotely. Phase 2 adds an in-app folder
   browser served by the remote.
3. **Open in VS Code** opens the remote file with VS Code Remote-SSH (`code --remote
   ssh-remote+<host> <path>`), run on the home machine.
4. **Updater, pets and Claude usage consent** are disabled in remote windows. Usage is shown from the
   home machine's own Claude, or hidden.
5. **Streams.** Terminal output is batched (it already is for IPC) and can be compressed. Reconnect
   uses backoff, shows a "Reconnecting…" banner, and re-attaches each terminal from its snapshot.
6. **The remote must be running.** Phase 1 requires the work machine's Apiary to be open, as the
   request assumes. A headless `apiary --server` that SSH can start (as VS Code installs a server) is
   a later option. A work Mac that sleeps drops the connection.

## How it would be tested

- **The contract, a third way.** Run `tests/contract/bridgeContract.ts`, every channel's clause,
  through the real remote protocol: a client and a server over a socket pair, in-process. The same
  spec already runs against the fake and the loopback, so the remote path cannot fall behind
  the local one.
- **An SSH integration suite in Docker.**
  - An `ubuntu:24.04` container with sshd, git, Node and the built app running headless (xvfb), with
    remote access on and the fixture `claude` in place of the real one.
  - The harness generates a client key and pins the container's host key in a temporary
    `known_hosts`.
  - Cases:
    - connect;
    - list the windows;
    - open a transcript;
    - type in a terminal and see the echo;
    - rename a session and see it at the other end.
  - Refusal and recovery cases:
    - **MITM:** swap the container's host key, and the connection is refused;
    - a wrong client key is refused;
    - a version mismatch is refused;
    - the socket modes are checked;
    - the network drops (pause the container) and Apiary reconnects.
- **End to end.** Playwright drives a home Electron instance: File → Open Remote Session → the
  container. The remote's two windows open, titled with the host, and the sidebar, a transcript and
  a terminal work.
- The Docker suite runs locally and on CI's Ubuntu runners (GitHub's have Docker). It is opt-in
  locally, like the live suites.

## Phases

1. **One remote window.**
   - Server socket, bridge, protocol, remote preload, client windows.
   - "Connect to host…" opens one remote window with the sidebar, transcript, chat and terminals.
   - The contract over the remote protocol, and the Docker SSH suite including the MITM case.
2. **The full request.**
   - Mirror all remote windows, the host in the title bar, the discovery submenu.
   - Reconnect, the connected-clients indicator, the pairing code.
3. **Polish.** Remote folder browser, Open in VS Code over SSH, a headless server mode.

## Decisions for the maintainer

1. **Shared or copied layouts.** Should the home windows be **live mirrors** of the work windows
   (opening a tab at home opens it at work too), or **copies** taken when you connect, with sessions
   and terminals shared live but each side arranging its own tabs? Copies are simpler and avoid both
   screens fighting. Recommended: copies.
2. **Authentication.** Is SSH enough, or do you want the optional pairing code on top? Recommended:
   SSH plus the host-key check; the code is optional.
3. **Discovery.** Are `~/.ssh/config`, recent hosts and Tailscale peers the right sources?
4. **Look.** Remote windows use the home machine's theme and settings for look and feel, and the work
   machine's data. Agreed?
5. **Running app or server.** Is "the work Apiary must be running" acceptable for the first version?
