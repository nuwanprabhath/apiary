import type { WebContents } from 'electron'
import type { ResidentService } from '../../residents/residentService'
import type { Handlers } from '../registrar'

type HandledKeys = 'residentsList' | 'residentsAdd' | 'residentHistory' | 'residentSend' | 'residentStop' | 'residentClear' | 'residentRedigest'
  | 'residentPermissionAnswer' | 'residentQuickAction' | 'residentSeen' | 'residentPickFolder' | 'residentKinds'

/**
 * The resident agents. The contract's guards have checked the id and kind; the service checks the
 * rest. A folder option's path comes from main's own dialog (`pickFolder`), never from the renderer.
 */
export function residentsHandlers(
  residents: ResidentService,
  pickFolder: ((sender: WebContents) => Promise<string | null>) | null,
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
    residentKinds: () => residents.kinds(),
  }
}
