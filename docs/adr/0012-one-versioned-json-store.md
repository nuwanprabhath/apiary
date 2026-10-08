# ADR-0012: Every persisted JSON file goes through one versioned `JsonStore`

- **Status:** Accepted
- **Context:** `settings.json`, `session-layout.json`, `themes.json` and `pets.json` each had their
  own read-and-fall-back block and their own write. Two copied a tmp+rename without an fsync, and
  wrote a `version: 1` that nothing read. A plain write truncates the file on a crash, and the next
  launch silently fell back to defaults. An older build also rewrote a file written by a newer one.
- **Decision:** `src/main/fs/jsonStore.ts`'s `JsonStore` loads (never throws; a missing, corrupt or
  unparseable file takes `fallback`), migrates by the stored version, and saves atomically with an
  fsync. A file whose version is newer than the code's is copied to `<file>.v<N>.bak` before the
  store's first write, never over an existing backup; if the copy fails the save throws and the file
  is untouched.
- **Alternatives tried:** A private tmp+rename per store (themes, pets): it drifted, with and without
  fsync, with and without a version that was read back. Refusing to start on a newer file was not
  tried: the user would lose the app over a downgrade.
- **Consequences:** A new userData JSON file is a `JsonStore` plus an entry in the persisted-stores
  architecture test named below. Directory fsync after the rename is deliberately not done (Windows cannot open a directory).
  Content-addressed blobs, the diagnostic log and regenerated shims are not state and may write
  directly (the `no-raw-state-write` allowlist names them).
- **Enforced by:** the `no-raw-state-write` ESLint rule (raw writes only under `src/main/fs`),
  `tests/unit/architecture/persistedStores.test.ts` (every userData `*.json` has an owner that opens
  it with `new JsonStore` and imports no raw fs), `tests/unit/jsonStore.test.ts`.

See "Persisted state: `JsonStore`" in [`src/main/CLAUDE.md`](../../src/main/CLAUDE.md).
