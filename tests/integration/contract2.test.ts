import { vi } from 'vitest'
import { defineBridgeContract } from '../contract/bridgeContract'

/** The real preload and main handlers over the loopback, part 2 of 2: see `contract.test.ts`. */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })
vi.mock('electron', async () => (await import('./support/electronLoopback')).electronMock())

const { buildLoopbackWorld } = await import('./support/loopbackWorld')

defineBridgeContract('real preload + main handlers (loopback)', async (options) => (await buildLoopbackWorld(options)).bridge, { part: 2 })
