# src/renderer/features/remote

Read with root CLAUDE.md and `docs/proposals/2026-10-10-remote-access.md`. The window-side UI of
remote access: the work machine is somewhere else, main runs ssh and opens its window.

- `RemoteView` (mounted by `RemoteRoot` in `App`, below the title bar) owns the `openRemoteDialog`
  event, the `remoteStatus` event and `document.title`. The dialog works in any window; the banner
  and the title only in a remote window (`remoteHost()` in `state/windowParams.ts`, from `remote=` in
  the URL).
- `RemoteDialog`: one host field checked with the contract's own `isRemoteHost`; the "Hosts" list is main's
  (`main/remote/hostDirectory.ts`: recent, ssh config, Tailscale, each with a probed status):
  opening the dialog asks `loadRemoteHosts(true)` and rows update on `remoteHostsChanged`; a click
  fills the field, a double-click connects. A failure
  stays in the dialog, whole (`remoteFailureText` strips only Electron's IPC wrapper).
- The pairing code: a `pairingError` rejection from `remoteConnect` (`shared/domain/remote.ts`) makes
  the dialog show a "Pairing code" field and send it as `remoteConnect`'s second argument. Main keeps
  a code that worked (`safeStorage`, never sent back here). The work machine's side (who is connected,
  Disconnect all, the code) is `features/settings/sections/RemoteAccessSetting.tsx`.
- `StartRemoteOffer` (rendered once, under the dialog's error): when a connect failed as "not
  accepting remote connections" and a probe made after it says `stopped`, or a double-clicked row
  is `stopped`, it offers `remoteStartAndConnect`. Only listed hosts are probed, so a typed host
  that is in no list gets no offer.
- `RemoteBanner`: in the layout's flow, so it pushes content down. Reconnect asks main for a fresh
  window and closes this one; "Close window" is `window.close()` (no IPC for it).
- `RemoteBadge`: drawn by `features/titleBar/TitleBar` for every title bar we draw (custom and Mac).
- Pets are not mounted in a remote window (`App`); they belong to the machine the person sits at.
- Tests: `tests/component/remote.test.tsx`, scenarios in `tests/component/ui/remote.ui.test.tsx`.
