/**
 * One behavioural spec of `window.apiary` (`ApiaryApi`), run against two implementations (TEST-5):
 *
 * - `tests/component/contract.test.tsx` runs it against `fakeApiary.ts`, the in-memory stand-in
 *   every component test renders against;
 * - `tests/integration/contract.test.ts` runs it against the real preload and the real main-process
 *   handlers (real `AppService`, real git, temp directories), connected by an in-process loopback
 *   instead of Electron's IPC transport.
 *
 * The fake is only worth anything as a *checked* model of main: a component test passes against
 * whatever the fake does, so every clause here is a way the two can no longer quietly disagree.
 * Clauses assert ids, titles and counts only, never absolute paths, so the same spec holds for
 * both. When the fake and main disagree, decide which one is wrong and fix that one.
 *
 * A third run, `tests/integration/remoteContract.test.ts`, puts a home window in front of a work
 * machine over the remote protocol; a clause that cannot hold there skips itself (`skipOnRemote`).
 *
 * The real main's runs build a real world per clause (about 0.3 s each), so each is split in two
 * files (`part`), which the integration project runs on separate workers; the fake's run has no
 * `part` and runs every area.
 *
 * The clauses live in `clauses/`, one file per area; `world.ts` is what both implementations are
 * configured with (the window, the plugins, the update feed), and `support.ts` the harness types.
 * `tests/unit/architecture/contractCoverage.test.ts` reads every file under this folder.
 *
 * Imports nothing from Node or the DOM: it runs under both Vitest configs.
 */
import { afterEach, beforeEach, describe } from 'vitest'
import type { ApiaryApi } from '@shared/api'
import { listen, LONG_SESSION, STANDARD_TITLES, type Bridge, type BridgeOptions, type Ctx, type Heard, type MakeBridge } from './support'
import { defineSessionClauses } from './clauses/sessions'
import { defineSearchClauses } from './clauses/search'
import { defineSettingsClauses } from './clauses/settings'
import { definePluginClauses } from './clauses/plugins'
import { defineThemeClauses } from './clauses/themes'
import { definePetClauses } from './clauses/pets'
import { defineChatClauses } from './clauses/chat'
import { defineUpdateClauses } from './clauses/update'
import { defineTabClauses } from './clauses/tabs'
import { defineGitClauses } from './clauses/git'
import { defineWorktreeClauses } from './clauses/worktrees'
import { defineTerminalClauses } from './clauses/terminals'
import { defineMiscClauses } from './clauses/misc'
import { defineSpellingClauses } from './clauses/spelling'
import { defineFolderClauses } from './clauses/folders'
import { defineRemoteClauses } from './clauses/remote'
import { defineRemoteConnectClauses } from './clauses/remoteConnect'
import { defineRemoteHostsClauses } from './clauses/remoteHosts'
import { defineRemoteClientsClauses } from './clauses/remoteClients'
import { defineRemoteStatusNowClauses } from './clauses/remoteStatusNow'
import { defineLibraryStateClauses } from './clauses/libraryState'
import { defineBackgroundTaskOutputClauses } from './clauses/backgroundTaskOutput'
import { defineAccountsClauses } from './clauses/accounts'
import { defineResidentsClauses } from './clauses/residents'

export { LONG_SESSION, STANDARD_TITLES }
export type { Bridge, BridgeOptions, MakeBridge }

/**
 * Every clause area, by its file in `clauses/`. `part` is which of a real-main run's two files runs
 * it (the parts take about the same time); the fake's run has no part and runs them all. `remote`
 * runs only in the remote run.
 */
const AREAS: readonly { clauses: string; define: (ctx: Ctx) => void; part: 1 | 2; remote?: true }[] = [
  { clauses: 'git', define: defineGitClauses, part: 1 },
  { clauses: 'sessions', define: defineSessionClauses, part: 1 },
  { clauses: 'tabs', define: defineTabClauses, part: 1 },
  { clauses: 'worktrees', define: defineWorktreeClauses, part: 1 },
  { clauses: 'update', define: defineUpdateClauses, part: 1 },
  { clauses: 'plugins', define: definePluginClauses, part: 1 },
  { clauses: 'folders', define: defineFolderClauses, part: 1 },
  { clauses: 'terminals', define: defineTerminalClauses, part: 1 },
  { clauses: 'libraryState', define: defineLibraryStateClauses, part: 1 },
  { clauses: 'search', define: defineSearchClauses, part: 2 },
  { clauses: 'settings', define: defineSettingsClauses, part: 2 },
  { clauses: 'themes', define: defineThemeClauses, part: 2 },
  { clauses: 'pets', define: definePetClauses, part: 2 },
  { clauses: 'chat', define: defineChatClauses, part: 2 },
  { clauses: 'misc', define: defineMiscClauses, part: 2 },
  { clauses: 'spelling', define: defineSpellingClauses, part: 2 },
  { clauses: 'remote', define: defineRemoteClauses, part: 2, remote: true },
  { clauses: 'remoteConnect', define: defineRemoteConnectClauses, part: 2 },
  { clauses: 'remoteHosts', define: defineRemoteHostsClauses, part: 2 },
  { clauses: 'remoteClients', define: defineRemoteClientsClauses, part: 2 },
  { clauses: 'remoteStatusNow', define: defineRemoteStatusNowClauses, part: 2 },
  { clauses: 'backgroundTaskOutput', define: defineBackgroundTaskOutputClauses, part: 2 },
  { clauses: 'accounts', define: defineAccountsClauses, part: 2 },
  { clauses: 'residents', define: defineResidentsClauses, part: 2 },
]

/** The clause areas, by file name in `clauses/`: the remote run checks every file there is one. */
export const CONTRACT_AREAS: readonly string[] = AREAS.map((a) => a.clauses)

export interface ContractRun {
  /** A home window showing a work machine: adds the `remote` area (`clauses/remote.ts`). */
  remote?: boolean
  /** Which half of the areas this file runs; none runs them all. */
  part?: 1 | 2
  /** Areas (file names in `clauses/`) this run leaves out, because another run covers them in full. */
  skip?: ReadonlySet<string>
}

export function defineBridgeContract(name: string, makeBridge: MakeBridge, options: ContractRun = {}): void {
  describe(`window.apiary contract: ${name}`, () => {
    let bridge: Bridge
    let heard: Heard
    const ctx: Ctx = {
      get api(): ApiaryApi { return bridge.api },
      get bridge(): Bridge { return bridge },
      get heard(): Heard { return heard },
      restart: async (options) => {
        heard.stop()
        await bridge.cleanup()
        bridge = await makeBridge(options)
        heard = listen(bridge.api)
      },
    }

    beforeEach(async () => {
      bridge = await makeBridge({})
      heard = listen(bridge.api)
    })
    afterEach(async () => { heard.stop(); await bridge.cleanup() })

    for (const area of AREAS) {
      if (area.remote === true && options.remote !== true) continue
      if (options.part !== undefined && area.part !== options.part) continue
      if (options.skip?.has(area.clauses) === true) continue
      area.define(ctx)
    }
  })
}
