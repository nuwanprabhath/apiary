# Remote windows

A window on this machine showing another machine's Apiary over SSH (or Tailscale SSH): its sidebar,
transcripts, chats and terminals. Remote windows have a coloured title bar and a `remote-badge`.

## Sub-features

- The dialog (`remote-hosts`, `remote-host-row`, `remote-connect`, `remote-pairing-*` for the
  pairing code, `remote-offer`/`remote-start` to offer this machine).
- In a remote window: the banner while reconnecting (`remote-banner`, `remote-reconnect`), and
  clicking an Active row raises the window already showing that tab.

## How to get to it (user POV)

File → Open Remote Session → a known host, or Other… for a new one.

## Driving it with launchApiary

Send `apiary:open-remote-dialog` to the window; proof: `remote-hosts` is visible. See
`drives/features.verify.ts`.

## Gotchas

- A connected remote window needs a second machine or the Docker SSH bed (`npm run test:remote`):
  unreachable from a plain drive.
