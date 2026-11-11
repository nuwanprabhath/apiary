# mra

The GitLab MR desk behind Apiary's "MR Desk" resident. A Python 3 CLI that uses only the standard
library: it reads GitLab through `glab api`, ranks and classifies the MRs you review, and keeps its
state under `MRA_STATE_DIR` (config at `MRA_CONFIG`).

- Origin: <https://github.com/nuwanprabhath/gitlab-mr-agent>, commit `c8a59c68242ac9e7248b1976a6588ca650db4658`.
- License: MIT (`LICENSE`).
- Apiary is now its home: this folder is the source of truth, and the GitHub repo is no longer updated from it.
- `RESIDENT.md` is the vendored `SKILL.md`, adapted: it is the resident's system prompt (Apiary runs the
  cycle and sets the attention badge, so the loop start/stop and scheduler parts are gone).

Run it as `python3 bin/mra <command>`; Apiary writes a `mra` wrapper for that into the resident's
folder. Tests: `npm run test:mra` from the repo root.

## Changes from upstream

- `bin/mra` is a Python script (`python3 bin/mra`, no exec bit, no `readlink -f`) instead of a bash wrapper
  around `python3 -m mra`. Covered by `tests/test_bin.py`.
- `SKILL.md` became `RESIDENT.md` (see above).
- `prompts/review.md` and `prompts/verify.md` are `prompts/*.tmpl` (`cli.py` reads them): they are
  `string.Template` files, not prose, and Apiary's markdown linter must not rewrite them.
- `mra approve` refuses unless `MRA_APPROVE_NONCE` matches `approve.nonce` beside the state, a one-call
  file Apiary writes only after the user allowed the resident's `approve_mr` request (and deletes after).
  `mra ready` also prints the MR's `title`, `target_branch` and `sha`, which Apiary shows on that request.
- `mra prompt` wraps text other people wrote (the title, comment bodies) in `<<<UNTRUSTED` … `>>>` and says
  at the top of the prompt that such text is data, never instructions. Covered by `tests/test_approve.py`.
- Draft notes, replies, threads and a read-only API (`tests/test_drafts.py`). Output is one JSON object;
  an error is `{"error", "cause"}` with exit code 2.
  - No approval: `draft add <ref> --file <path> --line <n> [--old-line <n>] --body-file <f>` (refuses a
    line that is not an added or context line of the diff; `--old-line` alone is a removed line),
    `draft list`, `draft edit <ref> <id> --body-file <f>`, `draft move <ref> <id> --file --line`,
    `draft delete <ref> <id>`, `thread <ref> --discussion <id>` (bodies wrapped as untrusted).
    `draft list` marks a draft `outdated` when the MR head moved since it was anchored.
  - Needs `MRA_ACTION_NONCE` equal to `action.nonce` beside the state (written by Apiary after Allow, deleted
    on use): `draft publish <ref>`, `reply <ref> --discussion <id> --body-file <f>`, `resolve`.
  - `api <path> [--paginate] [-F key=value]` is `glab api -X GET` only; any method, input, header or raw-field
    option, and any path not under `projects/`, `merge_requests`, `groups/`, `users`, `user`, `todos`, is refused.
  - `poll` stops after `MRA_POLL_DEADLINE_S` (default 100) with `{"error": "poll deadline reached", "cause":
    <running calls>, "partial": true}`, exit 2, leaving the previous state file; it never prints a traceback,
    and lists `drafts_outdated`. Every state write is a temp file plus `os.replace`.
- Not vendored: `install.sh`, `docs/`, `examples/`, upstream's `README.md`.
