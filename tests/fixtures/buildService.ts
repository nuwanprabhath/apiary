import { dirname } from 'node:path'
import type { AppService } from '../../src/main/appService'
import { createIpcState, createServices, type IpcStateInputs, type Services, type ServicesOptions } from '../../src/main/app/container'

/**
 * The session-side services around a temp directory, wired exactly as the app wires them
 * (`createServices` is what `createContainer` calls), returned as the `AppService` facade. Nothing
 * starts: no window, watcher, timer or poll.
 */
/** A test's options: `homeDir` defaults to the folder holding the test's own config root, never the real home. */
export type TestServicesOptions = Omit<ServicesOptions, 'homeDir'> & { homeDir?: string }

const inTestHome = (options: TestServicesOptions): ServicesOptions => ({ ...options, homeDir: options.homeDir ?? dirname(options.configRoot) })

export function buildAppService(options: TestServicesOptions): AppService {
  return createServices(inTestHome(options)).service
}

/** The same services, for a test that also hands the IPC handlers what sits beside the facade. */
export function buildServices(options: TestServicesOptions): Services {
  return createServices(inTestHome(options))
}

/**
 * The IPC handlers' shared objects around `service`, as the container builds them. By default there
 * is no tab registry and no windows, so nothing here moves a tab; a test that exercises tabs passes
 * the registry and the window functions it wants (the contract loopback does).
 */
export function buildIpcState(
  service: AppService, configRoot: string, windows: Partial<Pick<IpcStateInputs, 'tabRegistry' | 'openDetachedWindow' | 'windowNumberFor' | 'virtualContents' | 'accounts'>> = {},
): ReturnType<typeof createIpcState> {
  return createIpcState({
    pty: service.pty, configRoot, tabRegistry: null, openDetachedWindow: () => 0, windowNumberFor: () => null,
    // Every pty on the main account unless a test passes the real accounts.
    accounts: { configRootFor: () => configRoot, setAccountOf: () => undefined }, ...windows,
  })
}
