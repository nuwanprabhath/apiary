import { join } from 'node:path'
import type { AccountService } from '../accounts/accountService'
import { ClaudeOneShot } from '../claude/claudeOneShot'
import { Digester } from '../knowledge/digester'
import { KnowledgeService } from '../knowledge/knowledgeService'
import { KnowledgeStore } from '../knowledge/knowledgeStore'
import type { SearchService } from '../search/searchService'
import type { SessionStore } from '../store/sessionStore'

export interface KnowledgeParts {
  store: KnowledgeStore
  service: KnowledgeService
  digester: Digester
}

/** Where the digests and the residents' folders are; each defaults beside the session database. */
export interface KnowledgePaths {
  knowledgeDbPath?: string
  residentsDir?: string
}

export interface KnowledgeInputs extends KnowledgePaths {
  dataDir: string
  store: SessionStore
  search: SearchService
  accounts: AccountService
  claudeBin: () => string | null
}

/**
 * The knowledge index's part of the composition root (`createServices` calls it). Nothing here
 * starts: the digester runs only when a resident resumes it.
 */
export function createKnowledge(inputs: KnowledgeInputs): KnowledgeParts {
  const store = new KnowledgeStore(inputs.knowledgeDbPath ?? join(inputs.dataDir, 'knowledge.db'))
  return {
    store,
    service: new KnowledgeService({ store: inputs.store, search: inputs.search, knowledge: store }),
    digester: new Digester({
      store,
      sessions: () => inputs.store.visibleSessions().map((s) => ({
        sessionId: s.sessionId, file: s.filePath, cwd: s.cwd, lastActive: s.lastActiveAtMs ?? s.fileMtimeMs,
      })),
      runner: new ClaudeOneShot({ claudeBin: inputs.claudeBin }),
      accounts: inputs.accounts,
      residentsDir: inputs.residentsDir ?? join(inputs.dataDir, 'residents'),
    }),
  }
}
