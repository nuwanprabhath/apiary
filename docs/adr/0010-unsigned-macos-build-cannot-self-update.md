# ADR-0010: An unsigned macOS build downloads and opens its update, never installs in place

- **Status:** Accepted
- **Context:** Squirrel.Mac (the macOS auto-update mechanism `electron-updater` uses) will only
  replace a running app bundle if the replacement's code signature satisfies the running app's
  designated requirement. Apiary is not code-signed with a Developer ID.
- **Decision:** On macOS, the updater downloads the new `.dmg`, verifies it, and opens it for the
  user to install by hand — it never attempts to replace the running bundle in place. The capability
  is decided up front (`capability.ts`) from whether a Developer ID signature exists, not discovered
  by attempting the install and handling the failure.
- **Alternatives tried:** Not implemented and measured against — this follows directly from how
  Squirrel.Mac verifies the replacement, not from a bug found in production. The alternative (attempt
  the in-place install, handle the signature failure) was rejected because failing *after* a
  download is a worse experience than not offering it in the first place.
- **Consequences:** The day a Developer ID certificate exists, `hasDeveloperIdSignature()` flips to
  true and macOS updates become `auto` with no other code change — do not hardcode "macOS is always
  assisted" anywhere else that would need updating too.

See [`src/main/update/CLAUDE.md`](../../src/main/update/CLAUDE.md).
