import { join } from 'node:path'
import type { RuntimeEnv } from './env'

/** The on-disk locations that sit beside `userData`, in one place. */
export interface ContainerPaths {
  configRoot: string
  dbPath: string
  settingsFile: string
  sessionLayoutFile: string
  themesFile: string
  petsFile: string
  remoteHostsFile: string
  remotePairingFile: string
  remotePairingCodesFile: string
  libraryStateFile: string
  accountsFile: string
  /** One folder per added Claude account. */
  accountsDir: string
  /** The topic digests: costly to make, so a search rebuild leaves them be. */
  knowledgeDbPath: string
  /** One private folder per resident agent (`main/residents/residentSpace.ts`); the digester skips sessions run in it. */
  residentsDir: string
}

export function containerPaths(
  env: RuntimeEnv, userData: string, defaultConfigRoot: () => string,
): ContainerPaths {
  return {
    configRoot: env.configRoot ?? defaultConfigRoot(),
    dbPath: env.dbPath ?? join(userData, 'apiary.db'),
    settingsFile: join(userData, 'settings.json'),
    sessionLayoutFile: join(userData, 'session-layout.json'),
    themesFile: join(userData, 'themes.json'),
    petsFile: join(userData, 'pets.json'),
    remoteHostsFile: join(userData, 'remote-hosts.json'),
    remotePairingFile: join(userData, 'remote-pairing.json'),
    remotePairingCodesFile: join(userData, 'remote-pairing-codes.json'),
    libraryStateFile: join(userData, 'library-state.json'),
    accountsFile: join(userData, 'accounts.json'),
    accountsDir: join(userData, 'accounts'),
    knowledgeDbPath: join(userData, 'knowledge.db'),
    residentsDir: join(userData, 'residents'),
  }
}
