import { vi } from 'vitest'
import { defineBridgeContract } from '../contract/bridgeContract'

/**
 * The real preload and the real main-process handlers, joined by an in-process loopback instead of
 * Electron's IPC (TEST-5). `electron` is mocked: `ipcMain.handle` fills a Map, `ipcRenderer.invoke`
 * calls out of it, a fake window's `webContents.send` feeds the listeners `ipcRenderer.on`
 * registered, and arguments and results go through `structuredClone` as they do on the wire (so a
 * function or class instance leaking across the bridge fails here). Behind it: a real `AppService`
 * over temp directories, real git, one fake window (`THIS_WINDOW`: number 1, a known rectangle).
 * The same spec runs against `fakeApiary` in tests/component/contract.test.tsx; see
 * tests/contract/bridgeContract.ts.
 *
 * What is real, and what stands in:
 * - git: real, over a repository with a worktree and a bare `origin`; `outside` below is how the
 *   rest of the world (a teammate pushing, a commit made in a terminal) reaches it.
 * - `claude`: never the user's. Chat sessions and new sessions run `tests/fixtures/fake-claude-chat.mjs`
 *   as their binary; the one-shot calls (a pet's design, a theme, a remark) run a script that prints
 *   a canned reply. Nothing here can reach the network or spend tokens.
 * - plugins: the registries are the real classes, holding two plugins built from `contract/world.ts`.
 * - updates: the real `UpdateService` behind its fixture backend (`APIARY_FAKE_UPDATE`'s), offering
 *   `FEED_VERSION`.
 * - not modelled: the background indexer's `treeChanged`, the filesystem watcher, native dialogs
 *   (the folder picker and the pet file dialogs answer from here), the OS clipboard and `shell`.
 *
 * Mock state is declared before `vi.mock` and read lazily by its factory, the same pattern as
 * tests/integration/ipcWiring.test.ts.
 */
// A test builds a repository, services and sometimes a chat process: roomy limits for a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })
// The `electron` stand-in and the world around it live in `support/`, shared with remoteContract.test.ts.
vi.mock('electron', async () => (await import('./support/electronLoopback')).electronMock())

const { buildLoopbackWorld } = await import('./support/loopbackWorld')

defineBridgeContract('real preload + main handlers (loopback)', async (options) => (await buildLoopbackWorld(options)).bridge)
