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

export { LONG_SESSION, STANDARD_TITLES }
export type { Bridge, BridgeOptions, MakeBridge }

/** `remote`: the run is a home window showing a work machine, which adds its own clauses (`clauses/remote.ts`). */
export function defineBridgeContract(name: string, makeBridge: MakeBridge, options: { remote?: boolean } = {}): void {
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

    defineSessionClauses(ctx)
    defineSearchClauses(ctx)
    defineSettingsClauses(ctx)
    definePluginClauses(ctx)
    defineThemeClauses(ctx)
    definePetClauses(ctx)
    defineChatClauses(ctx)
    defineUpdateClauses(ctx)
    defineTabClauses(ctx)
    defineGitClauses(ctx)
    defineWorktreeClauses(ctx)
    defineTerminalClauses(ctx)
    defineMiscClauses(ctx)
    defineSpellingClauses(ctx)
    defineFolderClauses(ctx)
    if (options.remote === true) defineRemoteClauses(ctx)
    defineRemoteConnectClauses(ctx)
    defineRemoteHostsClauses(ctx)
    defineRemoteClientsClauses(ctx)
  })
}
