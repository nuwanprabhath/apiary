# ADR-0023: Update feeds are signed with our own key

- **Status:** Accepted
- **Context:** An update was verified against a sha512 read from `latest-*.yml` in the same release, so whoever could replace release assets could replace the feed and the installer together (review finding S4).
- **Decision:** The release workflow signs each `latest-*.yml` with an Ed25519 key (`scripts/sign-release.mjs`, secret `RELEASE_SIGNING_KEY` in the `release` environment) and uploads `<feed>.sig`. The app holds the public key (`releaseSignature.ts`) and refuses a feed with no signature or a bad one before reading any hash from it. It also refuses when electron-updater's own copy of the feed names another version, or other files or hashes, than the signed one (`servedMatchesSigned`), so an older signed feed cannot vouch for a new installer.
- **Alternatives tried:** Developer ID signing and notarisation: needs a paid account and covers macOS only, so the Linux feed would stay unverified. Not built.
- **Consequences:** `node:crypto` only, no dependency. Losing the private key means shipping a new public key in a release that old installs cannot verify: they install it by hand. Never publish an unsigned feed.
- **Enforced by:** `tests/unit/releaseSignature.test.ts`, `tests/unit/electronUpdaterBackend.test.ts`, and `sign-release.mjs` exiting non-zero without a matching key.

Story: [`src/main/update/CLAUDE.md`](../../src/main/update/CLAUDE.md).
