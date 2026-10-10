import { runEditCommand } from '../../windows/contextMenu'
import type { Listeners } from '../registrar'

export function contextMenuHandlers(): { listeners: Pick<Listeners, 'editCommand'> } {
  return {
    listeners: {
      editCommand(e, command) {
        runEditCommand(e.sender, command)
      },
    },
  }
}
