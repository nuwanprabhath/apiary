# Contributing to Apiary

This is the human-oriented onboarding path. [`CLAUDE.md`](CLAUDE.md) is the same information written
for a coding agent, and is the more detailed, more current reference for how any given subsystem
works — read it (and the nested `CLAUDE.md`/`docs/architecture/*` files it links to) once you're
past initial setup.

## Setup

```sh
nvm use            # or any Node >=22.22.1 — see .nvmrc
npm ci
npm start          # run the app
```

There is no native-module rebuild step to worry about: `better-sqlite3` and `node-pty` ship
prebuilt N-API binaries that work under both Node and Electron, so `npm start`, `npm test` and
`npm run test:e2e` all work straight after `npm ci`, in any order. See
[`docs/testing.md`](docs/testing.md) if you're curious why this used to be a trap.

## Commands and definition of done

See root [`CLAUDE.md`](CLAUDE.md)'s "Commands" and "Definition of done" sections for the full
command table and the checklist a change must pass before it's finished
(`npm run typecheck && npm run lint`, tests in the cheapest layer that proves the change).

## Versioning, changelog and commits

- **Every change bumps `package.json`'s version and adds its own `CHANGELOG.md` section** — this
  project publishes every commit, so there is no "batch several changes, bump once." See root
  `CLAUDE.md`'s "Versioning, changelog, commits" for the exact format (Conventional Commits, Keep a
  Changelog categories, the `(Linux only)`/`(not released)` annotation convention).
- No AI attribution in a commit message or PR description — the `commit-msg` hook rejects it.
- **Ask the maintainer before pushing, tagging or releasing.** A `v*` tag triggers the release
  workflow; builds get tested by hand first.
- `npm run audit` must be clean before tagging a release (it already gates CI and the release
  workflow).

## Linting and hooks

`npm run lint` runs five linters, and `.husky/` runs them for you:

- **ESLint** (`eslint.config.js`, type-aware via both tsconfigs plus `tsconfig.eslint.json` for the
  root configs). Per-area blocks encode the architecture: the renderer cannot import `electron`,
  `node:*` or main-process code, shared code cannot import either side, main cannot import the
  renderer. React hooks use React's own two classic rules only — the v7 React Compiler rules are
  off because the app does not use the compiler.
- **Stylelint** (`.stylelintrc.json`): standard's bug-catching rules without its formatting
  opinions, plus one of ours — no literal `border-radius` above 3px (see
  [`src/renderer/CLAUDE.md`](src/renderer/CLAUDE.md)).
- **markdownlint** (`.markdownlint-cli2.jsonc`) for the docs, plus `scripts/check-doc-refs.mjs`
  (DOC-11), which fails the build if a documented path no longer exists. **shellcheck** for `*.sh`.
  Shellcheck itself is a system binary, not an npm package (`scripts/lint-sh.mjs` shells out to
  it): the npm `shellcheck` wrapper fetched its binary through `decompress`, an unmaintained
  library with an unfixed zip-slip flaw. Install it with `brew install shellcheck` or
  `apt-get install shellcheck`; CI does the same.
- **madge** (`lint:cycles`) fails the build on a circular import in `src/` — a cycle across the
  main/renderer/shared boundary is usually a sign a type or helper is in the wrong layer.

The hooks: pre-commit lints and autofixes the staged files (lint-staged); commit-msg requires
Conventional Commits and rejects AI attribution; pre-push runs `typecheck` and the full `lint`.
Tests are deliberately not in a hook so they cannot fire underneath a run already in progress.

CI (`ci.yml`) has three jobs on every push to main and every pull request: `lint` (`npm run audit`,
then `typecheck`, then `lint`), `test` (`npm test` then `npm run test:component`, both headless —
neither launches Electron, so `ELECTRON_SKIP_BINARY_DOWNLOAD=1` skips downloading its binary for
nothing), and `e2e-smoke` (`npm run test:e2e:smoke` on Ubuntu under `xvfb-run`, with stand-in
`claude`/`glab`/`code` binaries and an isolated git identity). The rest of the e2e suite — the
parallel/serial split, multi-window and timing-sensitive specs — stays a local/manual gate before
tagging a release.

A disable comment (ESLint, Stylelint) is fine when it says why (`-- <reason>`);
`reportUnusedDisableDirectives` fails the lint once the reason stops applying.

## Release steps (maintainer)

1. Confirm `npm run typecheck && npm run lint && npm test && npm run test:component` pass, and the
   e2e suite you touched (see [`tests/CLAUDE.md`](tests/CLAUDE.md) for running one spec fast, or the
   full `npm run test:e2e` for main-process/wiring changes).
2. Confirm `package.json`'s version matches the latest `CHANGELOG.md` heading.
3. `git tag vX.Y.Z && git push origin main --tags` — this triggers `.github/workflows/release.yml`
   (verify → build → publish; see [`docs/packaging.md`](docs/packaging.md) for what each leg does).
4. Watch the release workflow. It fails closed: a failure in `verify` or either `build` leg means
   `publish` never runs, so a release goes out whole or not at all.

## Architecture

Start at root [`CLAUDE.md`](CLAUDE.md)'s "Architecture map" for the feature-to-path table, and
[`docs/architecture/`](docs/architecture/README.md) for the topics that span main and renderer
(multi-window ownership, activity classification, session following, the trust-boundary rules).
[`docs/adr/`](docs/adr/) has short decision records for the choices where an alternative was tried
and measured worse.
