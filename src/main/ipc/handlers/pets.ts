import { BrowserWindow, dialog, type WebContents } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { CHANNELS } from '@shared/api'
import { validatePet } from '@shared/pets/validate'
import { isPetPlace, PET_MODELS, type PetExportFile, type PetModel, type PetPatch } from '@shared/pets/state'
import type { VoiceContext } from '@shared/pets/prompt'
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

/** A pet file is small; anything much bigger is not one. */
const MAX_IMPORT_BYTES = 64 * 1024

const isModel = (m: unknown): m is PetModel => typeof m === 'string' && (PET_MODELS as readonly string[]).includes(m)
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(99, Math.round(v))) : 0)

/** The patch as main will apply it: only the fields it knows, each of the right kind. */
function cleanPatch(raw: Record<string, unknown>): PetPatch {
  const patch: PetPatch = {}
  if (typeof raw.name === 'string') patch.name = raw.name
  if (isModel(raw.model)) patch.model = raw.model
  if (typeof raw.size === 'number' && Number.isFinite(raw.size)) patch.size = raw.size
  if (typeof raw.active === 'boolean') patch.active = raw.active
  if (raw.place === null || isPetPlace(raw.place)) patch.place = raw.place
  return patch
}

function cleanContext(raw: Record<string, unknown>): VoiceContext {
  return {
    working: count(raw.working),
    waiting: count(raw.waiting),
    finished: count(raw.finished),
    titles: Array.isArray(raw.titles) ? (raw.titles as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 8) : [],
    hour: typeof raw.hour === 'number' && Number.isFinite(raw.hour) ? Math.max(0, Math.min(23, Math.floor(raw.hour))) : 12,
  }
}

function fileName(name: string): string {
  const safe = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim()
  return `${safe === '' ? 'pet' : safe}.apiarypet.json`
}

/**
 * The pet calls. Paths for export and import come from the native dialogs main opens itself —
 * never from the renderer (root CLAUDE.md's hard rule). An imported file is read with a size cap
 * and goes through `validatePet` like everything else.
 */
export function petsHandlers(deps: PetDeps): {
  handlers: Pick<Handlers, HandledKeys>
  listeners: Pick<Listeners, ListenedKeys>
} {
  const { store, service } = deps
  const changed = (): void => { broadcast(CHANNELS.petsChanged, service.state()) }
  const windowOf = (sender: WebContents): BrowserWindow | null => BrowserWindow.fromWebContents(sender)

  return {
    handlers: {
      petsState: () => service.state(),
      petsSetEnabled: async (_e, on) => { await service.setEnabled(on) },
      petGenerate: async (_e, description, model) => service.generate(description, isModel(model) ? model : 'haiku'),
      petUpdate: (_e, id, patch) => {
        const pet = store.update(id, cleanPatch(patch as unknown as Record<string, unknown>))
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
        const file: PetExportFile = { apiaryPet: 1, spec: pet.spec }
        writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
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
        const text = readFileSync(path, 'utf8')
        if (text.length > MAX_IMPORT_BYTES) throw new Error('That file is too large to be a pet.')
        let raw: unknown
        try { raw = JSON.parse(text) } catch { throw new Error('That file is not a pet.') }
        const spec = typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).apiaryPet === 1
          ? validatePet((raw as Record<string, unknown>).spec)
          : null
        if (spec === null) throw new Error('That file is not a pet.')
        const pet = store.add(spec)
        changed()
        return pet
      },
      petChat: async (_e, id, text) => service.chat(id, text),
      petVoice: async (_e, id, context) => service.voice(id, cleanContext(context as unknown as Record<string, unknown>)),
      petClaudeActions: async (_e, keys) => (store.enabled ? deps.actions(keys) : []),
      petComment: async (_e, id, action) => service.comment(id, action),
    },
    listeners: {
      petGenerateCancel: () => { service.cancelGenerate() },
    },
  }
}
