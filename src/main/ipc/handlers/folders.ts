import type { AppService } from '../../appService'
import type { FolderBrowser } from '../../folders/folderBrowser'
import type { Handlers, Listeners } from '../registrar'

type HandledKeys = 'folderBrowseOpen' | 'folderBrowseEnter' | 'folderBrowseUp' | 'folderBrowseCrumb' | 'newSessionInBrowsedFolder'

/**
 * The in-app folder browser a remote window uses where a local one uses the native picker. The
 * folder comes from the browse main holds, never from the renderer, which is what makes
 * `newSessionInFolder` (any folder under home) safe to call with it (ADR-0001).
 */
export function foldersHandlers(deps: { service: AppService; folderBrowser: FolderBrowser }): {
  handlers: Pick<Handlers, HandledKeys>
  listeners: Pick<Listeners, 'folderBrowseClose'>
} {
  const { service, folderBrowser } = deps
  return {
    handlers: {
      folderBrowseOpen: () => folderBrowser.open(),
      folderBrowseEnter: (_e, id, name) => folderBrowser.enter(id, name),
      folderBrowseUp: (_e, id) => folderBrowser.up(id),
      folderBrowseCrumb: (_e, id, index) => folderBrowser.crumb(id, index),
      newSessionInBrowsedFolder: async (_e, id) => service.newSessionInFolder(await folderBrowser.current(id)),
    },
    listeners: {
      folderBrowseClose: (_e, id) => { folderBrowser.close(id) },
    },
  }
}
