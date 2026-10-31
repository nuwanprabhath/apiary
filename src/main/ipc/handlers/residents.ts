import type { WebContents } from 'electron'
import type { FolderBrowser } from '../../folders/folderBrowser'
import type { ResidentService } from '../../residents/residentService'
import type { Handlers } from '../registrar'

type HandledKeys = 'residentsList' | 'residentsAdd' | 'residentHistory' | 'residentSend' | 'residentStop' | 'residentClear' | 'residentRedigest'
  | 'residentPermissionAnswer' | 'residentQuickAction' | 'residentSeen' | 'residentPickFolder' | 'residentUseBrowsedFolder' | 'residentKinds'

/**
 * The resident agents. The contract's guards have checked the id and kind; the service checks the
 * rest. A folder option's path comes from main's own dialog (`pickFolder`) or the folder a browse on
 * this machine is showing (`folderBrowser`), never from the renderer.
 */
export function residentsHandlers(
  residents: ResidentService,
  pickFolder: ((sender: WebContents) => Promise<string | null>) | null,
  folderBrowser: Pick<FolderBrowser, 'current'>,
): Pick<Handlers, HandledKeys> {
  return {
    residentsList: () => residents.list(),
    residentsAdd: (_e, kind) => residents.add(kind),
    residentHistory: (_e, id) => residents.history(id),
    residentSend: (_e, id, text) => residents.send(id, text),
    residentStop: (_e, id) => { residents.stop(id) },
    residentClear: (_e, id) => residents.clear(id),
    residentRedigest: (_e, id) => residents.redigest(id),
    residentPermissionAnswer: (_e, id, requestId, allow) => { residents.answerPermission(id, requestId, allow) },
    residentQuickAction: (_e, id, actionId) => residents.quickAction(id, actionId),
    residentSeen: (_e, id) => { residents.seen(id) },
    residentPickFolder: async (e, id, key) => {
      residents.requireFolderOption(id, key)
      const folder = pickFolder === null ? null : await pickFolder(e.sender)
      return folder === null ? null : residents.setFolderOption(id, key, folder)
    },
    // The browse resolves and confines its own position on this machine; the renderer sends only its id.
    residentUseBrowsedFolder: async (_e, id, key, browseId) => {
      residents.requireFolderOption(id, key)
      return residents.setFolderOption(id, key, await folderBrowser.current(browseId))
    },
    residentKinds: () => residents.kinds(),
  }
}
