import { vi } from 'vitest'
import { defineBridgeContract } from '../contract/bridgeContract'

/**
 * The bridge contract in a home window showing a work machine (see `support/remoteBridge.ts`), part
 * 2 of 2; `remoteContract.test.ts` runs the other areas. Areas whose every call a remote window handles
 * at home are left out: `contract.test.ts` runs them against the same handlers.
 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })
vi.mock('electron', async () => (await import('./support/electronLoopback')).electronMock())

const { makeRemoteBridge, HOME_ONLY_AREAS } = await import('./support/remoteBridge')

defineBridgeContract('remote: a home window over the remote protocol', makeRemoteBridge, { remote: true, part: 2, skip: HOME_ONLY_AREAS })
