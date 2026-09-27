# ADR-0007: The GitLab plugin shells out to `glab` instead of calling the API

- **Status:** Accepted
- **Context:** Showing a session's merge request needs to talk to GitLab, which usually means an
  API token.
- **Decision:** The GitLab plugin shells out to the `glab` CLI instead of calling GitLab's API
  directly. Apiary never holds, stores or asks for a GitLab credential; setup is `glab auth login`,
  which already handles self-hosted instances, scopes and token storage.
- **Alternatives tried:** Calling the API directly was the obvious approach and was rejected before
  implementation — not measured against, reasoned through: it would mean storing a credential,
  offering a field to paste it into, keeping it out of settings backups, and documenting what scope
  it needs, all of which `glab` already solves.
- **Consequences:** The plugin's assisted features (MR status) are unavailable if `glab` is not
  installed or not authenticated, and degrade to plain text rather than erroring. The
  no-API-needed half (opening a new-MR form from the git remote) has to keep working without `glab`
  present, since that's the fallback path.

See [`src/main/plugins/CLAUDE.md`](../../src/main/plugins/CLAUDE.md).
