import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeProjectsSource } from '../../src/main/sources/claudeProjects'
import type { WatchFn } from '../../src/main/sessions/sessionWatcher'

describe('ClaudeProjectsSource', () => {
  it('scans the configRoot/projects directory it was built from', async () => {
    const configRoot = mkdtempSync(join(tmpdir(), 'apiary-claude-projects-'))
    try {
      const projectDir = join(configRoot, 'projects', '-tmp-repo')
      mkdirSync(projectDir, { recursive: true })
      const sessionId = '11111111-1111-1111-1111-111111111111'
      writeFileSync(
        join(projectDir, `${sessionId}.jsonl`),
        `${JSON.stringify({ type: 'user', cwd: '/tmp/repo', sessionId, timestamp: new Date().toISOString(), message: { content: 'hi' } })}\n`,
      )

      const source = new ClaudeProjectsSource(configRoot)
      const metas = await source.scan()
      expect(metas.map((m) => m.sessionId)).toContain(sessionId)
    } finally {
      rmSync(configRoot, { recursive: true, force: true })
    }
  })

  it('places a transcript under the encoded project directory for a cwd', () => {
    const source = new ClaudeProjectsSource('/config-root')
    expect(source.transcriptPathFor('/Users/nuwan/repo', 'abc')).toBe(
      join('/config-root', 'projects', '-Users-nuwan-repo', 'abc.jsonl'),
    )
  })

  it('watches configRoot/projects and returns an unsubscribe that closes the watcher', () => {
    let closed = false
    let seenDir: string | undefined
    const watchFn: WatchFn = (dir) => {
      seenDir = dir
      const fakeWatcher = {
        on: () => fakeWatcher,
        close: async () => { closed = true },
      }
      return fakeWatcher as never
    }
    const source = new ClaudeProjectsSource('/config-root')
    const onChange = vi.fn()
    const stop = source.watch(onChange, { watch: watchFn })
    expect(seenDir).toBe(join('/config-root', 'projects'))
    stop()
    expect(closed).toBe(true)
  })
})
