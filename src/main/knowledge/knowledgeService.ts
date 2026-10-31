import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { SessionId } from '@shared/domain/ids'
import type { SessionHit, SessionHitReason } from '@shared/domain/residents'
import { queryTokens } from '../search/searchIndex'
import type { SearchService } from '../search/searchService'
import type { SessionStore, StoredSession } from '../store/sessionStore'
import { renderLine } from './digester'
import type { KnowledgeStore } from './knowledgeStore'
import type { ReadOptions, SessionKnowledge, SessionTopic } from './types'

/** A message read for a person (or a model answering one) is not cut as short as one read for a digest. */
const READ_MESSAGE_CHARS = 20_000
/** Rendered lines kept either side of a line that matched the query. */
const CONTEXT_LINES = 3
const BEST_MATCHES = 5

interface NumberedLine {
  n: number
  text: string
}

/**
 * Finds sessions by what they mention, what a digest says they were about, what was said in
 * them and what they are called, in that order; and reads the relevant part of one.
 */
export class KnowledgeService implements SessionKnowledge {
  constructor(private readonly deps: {
    store: Pick<SessionStore, 'getSession' | 'visibleSessions'>
    search: Pick<SearchService, 'search' | 'sessionsWithRefs'>
    knowledge: KnowledgeStore
  }) {}

  async find(query: string, limit: number): Promise<SessionHit[]> {
    const { store, search, knowledge } = this.deps
    const hits: SessionHit[] = []
    const seen = new Set<string>()
    const add = (id: string, reason: SessionHitReason, topic: string | null, snippet: string | null): void => {
      if (hits.length >= limit || seen.has(id)) return
      const s = store.getSession(id)
      if (s === null) return
      seen.add(id)
      hits.push(toHit(s, reason, topic, snippet))
    }
    const recentFirst = (ids: string[]): string[] => {
      const when = (id: string): number => store.getSession(id)?.lastActiveAtMs ?? 0
      return [...ids].sort((a, b) => when(b) - when(a))
    }

    for (const id of recentFirst(search.sessionsWithRefs(query))) add(id, 'ref', null, null)
    for (const t of knowledge.search(query, limit * 3)) add(t.sessionId, 'topic', t.title, t.snippet)
    for (const id of await search.search(query)) add(id, 'text', null, null)

    const tokens = queryTokens(query)
    if (tokens.length > 0) {
      const matching = store.visibleSessions().filter((s) => {
        const haystack = `${s.title ?? ''} ${s.gitBranch ?? ''} ${s.cwd ?? s.projectPath}`.toLowerCase()
        return tokens.every((t) => haystack.includes(t))
      })
      for (const s of matching.sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0))) {
        add(s.sessionId, 'title', null, null)
      }
    }
    return hits
  }

  topics(sessionId: SessionId): Promise<SessionTopic[]> {
    return Promise.resolve(this.deps.knowledge.topicsOf(sessionId))
  }

  async read(sessionId: SessionId, options: ReadOptions): Promise<string | null> {
    // The file comes from the session store, never from a path the caller names.
    const session = this.deps.store.getSession(sessionId)
    if (session === null) return null
    const lines = await readLines(session.filePath)
    const picked = this.pick(sessionId, lines, options)
    return fit(picked, options.maxChars, options.topicId !== undefined || options.query !== undefined)
  }

  private pick(sessionId: SessionId, lines: NumberedLine[], options: ReadOptions): NumberedLine[] {
    if (options.topicId !== undefined) {
      const topic = this.deps.knowledge.topic(sessionId, options.topicId)
      if (topic !== null) return lines.filter((l) => l.n >= topic.startLine && l.n <= topic.endLine)
    }
    const tokens = queryTokens(options.query ?? '')
    if (tokens.length > 0) {
      const scored = lines
        .map((l, i) => ({ i, score: tokens.filter((t) => l.text.toLowerCase().includes(t)).length }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || b.i - a.i)
        .slice(0, BEST_MATCHES)
      if (scored.length > 0) {
        const keep = new Set<number>()
        for (const { i } of scored) {
          for (let k = Math.max(0, i - CONTEXT_LINES); k <= Math.min(lines.length - 1, i + CONTEXT_LINES); k++) keep.add(k)
        }
        return [...keep].sort((a, b) => a - b).map((i) => lines[i])
      }
    }
    return lines
  }
}

const toHit = (s: StoredSession, reason: SessionHitReason, topic: string | null, snippet: string | null): SessionHit => ({
  sessionId: s.sessionId,
  title: s.title ?? s.firstPrompt ?? s.sessionId,
  folder: s.cwd ?? s.projectPath,
  branch: s.gitBranch,
  lastActive: s.lastActiveAtMs ?? s.fileMtimeMs,
  reason,
  topic,
  snippet,
})

async function readLines(file: string): Promise<NumberedLine[]> {
  const out: NumberedLine[] = []
  let n = 0
  const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  try {
    for await (const line of reader) {
      n += 1
      const text = renderLine(n, line, READ_MESSAGE_CHARS)
      if (text !== null) out.push({ n, text })
    }
  } finally {
    reader.close()
  }
  return out
}

/** Within `maxChars`: from the start of a chosen range, or the end of the whole transcript (the tail). */
function fit(lines: NumberedLine[], maxChars: number, fromStart: boolean): string {
  const kept: string[] = []
  let used = 0
  const ordered = fromStart ? lines : [...lines].reverse()
  for (const l of ordered) {
    const text = l.text.length + 1 > maxChars - used ? l.text.slice(0, Math.max(0, maxChars - used - 1)) : l.text
    if (text === '') break
    kept.push(text)
    used += text.length + 1
    if (used >= maxChars) break
  }
  return (fromStart ? kept : kept.reverse()).join('\n')
}
