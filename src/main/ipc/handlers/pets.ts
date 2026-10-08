import { BrowserWindow, dialog, type WebContents } from 'electron'
import { IPC } from '@shared/api'
import { isOneOf } from '@shared/guards'
import { PET_MODELS } from '@shared/pets/state'
import { limitVoiceContext, pickPetPatch } from '@shared/pets/ipcGuards'
import type { PetStore } from '../../pets/petStore'
import type { PetService } from '../../pets/petService'
import { broadcast } from '../../windows/broadcast'
import type { Handlers, Listeners } from '../registrar'

export interface PetDeps {
  store: PetStore
  service: PetService
  /** What the given sessions are doing (`AppService.latestActions`). */
  actions: (keys: string[]) => Promise<{ key: string; action: string }[]>
  /** Test-only answers for the save and open dialogs (`APIARY_PET_EXPORT_PATH` / `_IMPORT_PATH`). */
  exportPath?: string
  importPath?: string
}

type HandledKeys =
  | 'petsState' | 'petsSetEnabled' | 'petGenerate' | 'petUpdate' | 'petDelete' | 'petExport' | 'petImport'
  | 'petChat' | 'petVoice' | 'petClaudeActions' | 'petComment'
type ListenedKeys = 'petGenerateCancel'

function fileName(name: string): string {
  const safe = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim()
  return `${safe === '' ? 'pet' : safe}.apiarypet.json`
}

/**
 * The pet calls. Paths for export and import come from the native dialogs main opens itself —
 * never from the renderer (root CLAUDE.md's hard rule). The file I/O is `PetService`'s
 * (`exportToFile`, `importFromFile`); this only asks where.
 */
export function petsHandlers(deps: PetDeps): {
  handlers: Pick<Handlers, HandledKeys>
  listeners: Pick<Listeners, ListenedKeys>
} {
  const { store, service } = deps
  const changed = (): void => { broadcast(IPC.petsChanged, service.state()) }
  const windowOf = (sender: WebContents): BrowserWindow | null => BrowserWindow.fromWebContents(sender)

  return {
    handlers: {
      petsState: () => service.state(),
      petsSetEnabled: async (_e, on) => { await service.setEnabled(on) },
      petGenerate: async (_e, description, model) => service.generate(description, isOneOf(PET_MODELS, model) ? model : 'haiku'),
      petUpdate: (_e, id, patch) => {
        const pet = store.update(id, pickPetPatch(patch))
        changed()
        return pet
      },
      petDelete: (_e, id) => {
        store.remove(id)
        service.forget(id)
        changed()
      },
      petExport: async (e, id) => {
        const pet = store.get(id)
        if (pet === undefined) throw new Error('No such pet.')
        let path = deps.exportPath
        if (path === undefined) {
          const win = windowOf(e.sender)
          const options = { title: `Export ${pet.spec.name}`, defaultPath: fileName(pet.spec.name), filters: [{ name: 'Apiary pet', extensions: ['json'] }] }
          const result = win !== null ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
          if (result.canceled || result.filePath === undefined) return false
          path = result.filePath
        }
        service.exportToFile(id, path)
        return true
      },
      petImport: async (e) => {
        let path = deps.importPath
        if (path === undefined) {
          const win = windowOf(e.sender)
          const options = { title: 'Import a pet', properties: ['openFile' as const], filters: [{ name: 'Apiary pet', extensions: ['json'] }] }
          const result = win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
          if (result.canceled || result.filePaths.length === 0) return null
          path = result.filePaths[0]
        }
        return service.importFromFile(path)
      },
      petChat: async (_e, id, text) => service.chat(id, text),
      petVoice: async (_e, id, context) => service.voice(id, limitVoiceContext(context)),
      petClaudeActions: async (_e, keys) => (store.enabled ? deps.actions(keys) : []),
      petComment: async (_e, id, action) => service.comment(id, action),
    },
    listeners: {
      petGenerateCancel: () => { service.cancelGenerate() },
    },
  }
}
