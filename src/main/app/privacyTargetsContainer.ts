import { dialog } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppSettings } from '../settings'
import type { AppService } from '../appService'
import type { KnowledgeParts } from './knowledgeContainer'
import type { ContainerPaths } from './containerPaths'
import type { PrivacyParts, PrivacyWorkers } from './privacyContainer'
import type { ScheduleParts } from './scheduleContainer'
import type { ResidentService } from '../residents/residentService'
import type { SlackBridge } from '../slack/slackBridge'
import type { SessionStore } from '../store/sessionStore'
import { ImageStore } from '../media/imageStore'
import { ResidentSpace } from '../residents/residentSpace'
import { log } from '../log/logger'
import { createRetentionSweeper } from '../privacy/retentionSweeper'
import { createPurgeService } from '../privacy/purgeService'
import { createExportService } from '../privacy/exportService'

/** What `withPrivacyTargets` reads off the finished container. */
export interface PrivacyTargetsHost {
  paths: ContainerPaths
  settingsService: { get(): AppSettings }
  privacy: PrivacyParts
  service: AppService
  knowledge: KnowledgeParts
  residents: ResidentService
  schedules: ScheduleParts
  slack: SlackBridge
}

const PASTED_IMAGE_NAME = /pasted-images[\\/]+([\w.-]+\.(?:png|jpe?g|gif|webp))/g

/**
 * Image names any of these transcripts last modified at or after `sinceMs` mention; a transcript that
 * cannot be read keeps nothing alive.
 */
async function imagesNamedIn(files: string[], sinceMs: number): Promise<Set<string>> {
  const names = new Set<string>()
  for (const file of files) {
    let text: string
    try {
      if ((await stat(file)).mtimeMs < sinceMs) continue
      text = await readFile(file, 'utf8')
    } catch { continue }
    for (const m of text.matchAll(PASTED_IMAGE_NAME)) if (m[1] !== undefined) names.add(m[1])
  }
  return names
}

function clearSessionMetadata(store: SessionStore): void {
  for (const s of store.allSessions()) {
    store.setCustomTitle(s.sessionId, null)
    if (s.note !== null) store.setNote(s.sessionId, null)
  }
}

/**
 * Builds the purge, export and retention sweeper over the container's own stores and hands them to
 * `privacy`. Pure: the sweeper's timer starts only from `privacy.startSweeper()` in `index.ts`.
 */
export function withPrivacyTargets<T extends PrivacyTargetsHost>(c: T, store: SessionStore): T {
  const { paths, knowledge, residents, schedules, slack } = c
  const images = new ImageStore({ dir: join(paths.userData, 'pasted-images') })
  const space = (id: string): ResidentSpace => new ResidentSpace(paths.residentsDir, id)
  const residentIds = (): string[] => c.settingsService.get().residents.map((r) => r.id)
  const sweeper = createRetentionSweeper({
    settings: () => c.settingsService.get(),
    knowledge: knowledge.store,
    liveSessionIds: () => new Set(store.visibleSessions().map((s) => s.sessionId)),
    images,
    referencedImages: (since) => imagesNamedIn(store.visibleSessions().map((s) => s.filePath), since),
    scheduled: schedules.jobs,
    residentsDir: paths.residentsDir,
    residentSpace: {
      pruneHistoryOlderThan: (id, cutoff) => residents.pruneHistoryOlderThan(id, cutoff) ?? space(id).pruneHistoryOlderThan(cutoff),
      removeOrphans: (dir, live, untouchedSince) => ResidentSpace.removeOrphans(dir, live, untouchedSince),
    },
    // The awaiting list lives in the Slack store; the bridge already drops entries older than a day on every poll.
    slackAwaiting: null,
    now: Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms).unref(),
    clearTimer: (t) => { clearTimeout(t as NodeJS.Timeout) },
  })
  const purge = createPurgeService({
    roots: [paths.userData, dirname(paths.dbPath)],
    targets: {
      searchIndex: { paths: [join(dirname(paths.dbPath), 'search.db')], run: () => c.service.rebuildSearchIndex() },
      digests: { paths: [paths.knowledgeDbPath], run: () => knowledge.digester.reset() },
      logs: { paths: [join(paths.userData, 'logs')], run: async () => { log.clear() } },
      residentHistory: {
        paths: [paths.residentsDir],
        run: async () => {
          for (const id of residentIds()) {
            await residents.clear(id)
            await space(id).clearNotesAndState()
          }
        },
      },
      slackMessages: { paths: [], run: async () => { slack.tasks.clearMessages() } },
      pastedImages: { paths: [join(paths.userData, 'pasted-images')], run: async () => { await images.clear() } },
      scheduledLogs: { paths: [join(paths.userData, 'scheduled')], run: async () => { schedules.jobs.clearLogs() } },
      sessionMetadata: { paths: [], run: async () => { clearSessionMetadata(store) } },
    },
  })
  const exporter = createExportService({
    pickFolder: async () => {
      const result = await dialog.showOpenDialog({ title: 'Export my Apiary data', properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    now: Date.now,
    digests: () => knowledge.store.allTopics(),
    residents: () => residentIds().map((id) => ({ id, history: () => space(id).loadHistory(), notes: () => space(id).notes() })),
    settings: () => c.settingsService.get(),
  })
  const workers: PrivacyWorkers = { purge: (req) => purge.purge(req), export: () => exporter.export(), sweeper }
  c.privacy.attach(workers)
  return c
}
