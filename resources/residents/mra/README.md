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
- Not vendored: `install.sh`, `docs/`, `examples/`, upstream's `README.md`.
