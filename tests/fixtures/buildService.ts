import type { AppService } from '../../src/main/appService'
import { createIpcState, createServices, type IpcStateInputs, type ServicesOptions } from '../../src/main/app/container'

/**
 * The session-side services around a temp directory, wired exactly as the app wires them
 * (`createServices` is what `createContainer` calls), returned as the `AppService` facade. Nothing
 * starts: no window, watcher, timer or poll.
 */
export function buildAppService(options: ServicesOptions): AppService {
  return createServices(options).service
}

/**
 * The IPC handlers' shared objects around `service`, as the container builds them. By default there
 * is no tab registry and no windows, so nothing here moves a tab; a test that exercises tabs passes
 * the registry and the window functions it wants (the contract loopback does).
 */
export function buildIpcState(
  service: AppService, configRoot: string, windows: Partial<Pick<IpcStateInputs, 'tabRegistry' | 'openDetachedWindow' | 'windowNumberFor'>> = {},
): ReturnType<typeof createIpcState> {
  return createIpcState({
    pty: service.pty, configRoot, tabRegistry: null, openDetachedWindow: () => 0, windowNumberFor: () => null, ...windows,
  })
}
