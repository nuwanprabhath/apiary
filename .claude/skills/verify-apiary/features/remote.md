# Remote windows

A window on this machine showing another machine's Apiary over SSH (or Tailscale SSH): its sidebar,
transcripts, chats and terminals. Remote windows have a coloured title bar and a `remote-badge`.

## Sub-features

- The dialog: the host field (`remote-host`, `remote-host-hint` when it is not a host name),
  `remote-connect`, `remote-cancel`, and the known hosts (`remote-hosts`, only when there are any:
  one `remote-host-row` each, from recent connections, `~/.ssh/config` and Tailscale, each with a
  `remote-host-status`). `remote-pairing-*` appears only once the work machine asks for a pairing
  code; `remote-offer` / `remote-start` only for a host where Apiary is not running, to start it
  there and connect. A failure shows `remote-error`.
- The work machine's side, in Settings → General: `setting-remote-access`, `setting-remote-pairing`
  and its code (`remote-pairing-code`, `remote-pairing-new`, `remote-pairing-copy`), the connected
  clients (`remote-clients`, `remote-disconnect-all`), and `remote-server-failure` when another
  Apiary already serves.
- In a remote window: the banner (`remote-banner`; while reconnecting `remote-banner-attempt`, once
  disconnected `remote-reconnect`), the settings machine switch, and clicking an Active row raises
  the window already showing that tab.

## How to get to it (user POV)

File → Open Remote Session → a known host (listed with its status), or Other Host… for a new one.

## Driving it with launchApiary

Launch with `sshConfig` pointing at a throwaway config (`Host work-box` / `HostName
work-box.invalid`), then send `apiary:open-remote-dialog` to the window; proof: a `remote-host-row`
for work-box whose status turns to "unreachable". See `drives/features.verify.ts`.

## Gotchas

- A connected remote window needs a second machine or the Docker SSH bed (`npm run test:remote`):
  unreachable from a plain drive. So do the banner, the pairing ask in the dialog, the offer to
  start Apiary there, the connected clients and the machine switch.
- Without `sshConfig` the dev app reads the maintainer's real `~/.ssh/config` and probes those hosts
  over ssh (HOME is not isolated in a dev launch).
- Do not tick `setting-remote-access` in a drive: it binds the real `~/.apiary/remote.sock`.
