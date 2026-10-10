import { IPC } from '@shared/api'
import { contextMenuRequestFrom, type ContextMenuParamsLike, type EditCommand } from '@shared/domain/contextMenu'
import { sendEvent } from './sendEvent'

interface MenuContents {
  on(event: 'context-menu', listener: (event: unknown, params: ContextMenuParamsLike) => void): unknown
  send(channel: string, ...args: unknown[]): void
}

interface EditTarget {
  cut(): void
  copy(): void
  paste(): void
  selectAll(): void
  replaceMisspelling(word: string): void
}

export function watchContextMenu(contents: MenuContents): void {
  contents.on('context-menu', (_event, params) => {
    sendEvent(contents, IPC.contextMenuRequested, contextMenuRequestFrom(params))
  })
}

export function runEditCommand(target: EditTarget, command: EditCommand): void {
  if (command.action === 'replaceMisspelling') target.replaceMisspelling(command.word)
  else target[command.action]()
}
