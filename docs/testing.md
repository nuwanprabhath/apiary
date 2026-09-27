# The native-module ABI trap, and why it no longer bites

`better-sqlite3` and `node-pty` are native modules with compiled bindings, and Electron's Node ABI
used to differ from your system Node's — so the same `node_modules` could not serve both without
being rebuilt for whichever runtime last touched them. Running `npm test` (plain Node) after
`npm run test:e2e` (Electron) used to leave the modules in the wrong ABI for the next `npm start`,
and vice versa: a classic "works on my machine, fails in CI" trap, and the reason CLAUDE.md used to
carry a large warning table about which script rebuilt for which runtime.

As of better-sqlite3 13 and node-pty 1.1 (Electron 44), both ship prebuilt N-API binaries
(`node_modules/better-sqlite3/prebuilds/`, `node_modules/node-pty/prebuilds/`), and N-API is
ABI-stable across Node and Electron versions. Measured on a fresh `npm ci` with no rebuild: both
`require('better-sqlite3')` and `require('node-pty')` load correctly under plain Node and under
Electron (`ELECTRON_RUN_AS_NODE=1 electron -e "require(...)"`). None of the npm scripts run a
rebuild anymore — `npm start`, `npm test` and `npm run test:e2e` all work straight after install,
in any order, at the same time. This was TEST-1 in the 2026-09-26 review.

`rebuild:electron` and `rebuild:node` still exist as manual escape hatches (for a platform whose
prebuild is missing, or a future major version that drops N-API), but nothing calls them
automatically. If you ever see a native-module load error that looks like an ABI mismatch again,
check whether a dependency bump dropped N-API support before reaching for these.

See also [tests/CLAUDE.md](../tests/CLAUDE.md) for the current test layers and how to run a single
test in each, and root CLAUDE.md's "Commands" table for the day-to-day command list.
