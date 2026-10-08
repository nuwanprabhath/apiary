import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeProjectsSource, projectsDir } from '../../src/main/sources/claudeProjects'

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

  it('is watched at configRoot/projects, the same directory it scans', () => {
    expect(projectsDir('/home/nuwan/.claude')).toBe('/home/nuwan/.claude/projects')
    expect(new ClaudeProjectsSource('/config-root').watchDir).toBe(join('/config-root', 'projects'))
  })
})
