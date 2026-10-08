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

`npm run lint` runs five linters, and `.husky/` runs them for you. Most of the architecture is
checked by machine: one sanctioned way to do each thing, with an error message that names the
replacement. The "Rules and what enforces them" table in [`CLAUDE.md`](CLAUDE.md) is the map.

- **ESLint `apiary/*` rules** (`eslint/sanctioned.js`): each allows only its sanctioned files, such
  as `main/exec` for processes or `renderer/state` for `window.apiary`. When one fires, do what its
  message says; do not add your file to `allow`.
- **Architecture tests** (`tests/unit/architecture/`): fitness functions over the source (IPC guards,
  contract coverage, the composition root, duplicate helpers, error boundaries).
- **Knip** (`npm run lint:dead`): a ratchet against new dead code.
- **Baselines**: violations that predate a rule sit in `eslint-suppressions.json`,
  `stylelint-suppressions.json`, `.dependency-cruiser-known-violations.json`, `.knip-baseline.json`
  and the architecture tests' `*.allow.json`. They only shrink. After you fix one, run
  `npm run lint:prune`, `npm run lint:arch:baseline` or `npm run lint:dead:baseline` and commit the
  smaller file; `npm run lint:debt` shows the totals. Never add an entry to make a check pass.
- **Generators**: `npm run new -- <ipc|store|feature|service> <name>` writes the files a new piece
  needs, with stubs that fail until you finish them.

The linters:

- **ESLint** (`eslint.config.js`, type-aware via both tsconfigs plus `tsconfig.eslint.json` for the
  root configs). Per-area blocks encode the architecture: the renderer cannot import `electron`,
  `node:*` or main-process code, shared code cannot import either side, main cannot import the
  renderer. React hooks use React's own two classic rules only — the v7 React Compiler rules are
  off because the app does not use the compiler.
- **Stylelint** (`.stylelintrc.json`): standard's bug-catching rules without its formatting
  opinions, plus one of ours — shape comes from tokens: no literal `border-radius` above 3px, and no
  literal control height, padding or gap of 4px or more (see
  [`src/renderer/CLAUDE.md`](src/renderer/CLAUDE.md)).
- **markdownlint** (`.markdownlint-cli2.jsonc`) for the docs, plus `scripts/check-doc-refs.mjs`
  (DOC-11), which fails the build if a documented path no longer exists. **shellcheck** for `*.sh`.
  Shellcheck itself is a system binary, not an npm package (`scripts/lint-sh.mjs` shells out to
  it): the npm `shellcheck` wrapper fetched its binary through `decompress`, an unmaintained
  library with an unfixed zip-slip flaw. Install it with `brew install shellcheck` or
  `apt-get install shellcheck`; CI does the same.
- **dependency-cruiser** (`lint:arch`, `.dependency-cruiser.cjs`) fails the build on a circular
  import in `src/` and on an import that points the wrong way between layers. In main, the order is
  app → ipc → services → infra. In the renderer, features → state/ui, and a feature is imported
  only through its `index.ts`. Edges that already broke a rule are listed in
  `.dependency-cruiser-known-violations.json`. Only new ones fail. After you fix one, run
  `npm run lint:arch:baseline` to shrink the list.

The hooks: pre-commit lints and autofixes the staged files (lint-staged); commit-msg requires
Conventional Commits and rejects AI attribution; pre-push runs `typecheck`, the full `lint` and
`test:unit` (native-free and quick). Integration, component and e2e tests stay out of hooks: they
are slower and some drive real git and pty subprocesses, which must not fire underneath a run
already in progress.

For coding agents, `.claude/settings.json` adds two more: `.claude/hooks/lint-edited.mjs` lints each
file right after it is edited, and `.claude/hooks/definition-of-done.mjs` blocks a stop while the
typecheck or the changed files' lint fails.

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
