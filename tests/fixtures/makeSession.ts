import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FixtureOptions {
  sessionId: string
  cwd: string
  gitBranch?: string
  title?: string
  firstPrompt?: string
  /** Extra JSONL lines appended verbatim, e.g. corrupt ones. */
  extraLines?: string[]
  /** Padding assistant turns, used to push content past a chunk boundary. */
  padTurns?: number
}

/** Writes a session JSONL into `projectsRoot/<slug>/` and returns its path. */
export function makeSession(projectsRoot: string, slug: string, o: FixtureOptions): string {
  const dir = join(projectsRoot, slug)
  mkdirSync(dir, { recursive: true })
  const lines: string[] = []
  const base = {
    sessionId: o.sessionId,
    cwd: o.cwd,
    gitBranch: o.gitBranch ?? 'main',
    isSidechain: false,
    version: '2.1.246',
  }

  lines.push(JSON.stringify({ type: 'queue-operation', operation: 'enqueue', sessionId: o.sessionId }))
  lines.push(JSON.stringify({
    ...base,
    type: 'user',
    uuid: 'u1',
    timestamp: '2026-09-01T10:00:00.000Z',
    message: { role: 'user', content: o.firstPrompt ?? 'fix the export' },
  }))

  for (let i = 0; i < (o.padTurns ?? 0); i++) {
    lines.push(JSON.stringify({
      ...base,
      type: 'assistant',
      uuid: `a${i}`,
      timestamp: '2026-09-01T10:01:00.000Z',
      // Each pad turn's text embeds its own index so tests can identify a specific message
      // (e.g. to detect duplicate rendering after a paging fetch) instead of matching on
      // indistinguishable filler content.
      message: { role: 'assistant', content: [{ type: 'text', text: `pad-${i} ${'x'.repeat(190)}` }] },
    }))
  }

  for (const extra of o.extraLines ?? []) lines.push(extra)

  if (o.title) {
    lines.push(JSON.stringify({ type: 'ai-title', aiTitle: o.title, sessionId: o.sessionId }))
  }
  lines.push(JSON.stringify({
    ...base,
    type: 'assistant',
    uuid: 'last',
    timestamp: '2026-09-02T12:00:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
  }))

  const file = join(dir, `${o.sessionId}.jsonl`)
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}
