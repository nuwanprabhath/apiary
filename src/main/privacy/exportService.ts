import { join } from 'node:path'
import type { ResidentMessage } from '@shared/domain/residents'
import { ensurePrivateDir, writePrivateText } from '../fs/atomicWrite'
import { log } from '../log/logger'

export interface ExportServiceDeps {
  /** Main's folder dialog; null when the person cancelled. */
  pickFolder: () => Promise<string | null>
  now: () => number
  /** Every digest topic; null when this build has no digests. */
  digests: (() => { sessionId: string; topic: unknown }[]) | null
  residents: () => { id: string; history: () => ResidentMessage[]; notes: () => Record<string, string> }[]
  /** The settings as stored. No credential lives there: the Slack token is in slack.json, encrypted. */
  settings: () => object
}

const README = `This folder is a copy of what Apiary keeps about you on this computer.

digests.json        Topic summaries Apiary wrote of your Claude Code sessions (session id, title,
                    summary, keywords, references, line range).
residents/<id>/     For each resident agent: history.json (its chat) and notes.json (what it noted).
settings.json       Your Apiary settings.

Not included: your Claude Code transcripts (they are Claude Code's, under ~/.claude), the search
index (rebuilt from those transcripts), and any token or password.
`

const asJsonText =(data: unknown): string => `${JSON.stringify(data, null, 2)}\n`

/** Writes `apiary-export-<date>/` where the person chooses; files 0600, folders 0700. */
export function createExportService(deps: ExportServiceDeps): { export(): Promise<string | null> } {
  return {
    export: async () => {
      const parent = await deps.pickFolder()
      if (parent === null) return null
      const dir = join(parent, `apiary-export-${new Date(deps.now()).toISOString().slice(0, 10)}`)
      ensurePrivateDir(dir)
      writePrivateText(join(dir, 'digests.json'), asJsonText(deps.digests?.() ?? []))
      const residents = deps.residents()
      for (const r of residents) {
        const space = join(dir, 'residents', r.id)
        ensurePrivateDir(join(dir, 'residents'))
        ensurePrivateDir(space)
        writePrivateText(join(space, 'history.json'), asJsonText(r.history()))
        writePrivateText(join(space, 'notes.json'), asJsonText(r.notes()))
      }
      writePrivateText(join(dir, 'settings.json'), asJsonText(deps.settings()))
      writePrivateText(join(dir, 'README.txt'), README)
      log.info('privacy', 'export written', { residents: residents.length })
      return dir
    },
  }
}
