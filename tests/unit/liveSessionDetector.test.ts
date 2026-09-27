import { describe, it, expect } from 'vitest'
import { parseLiveSessions, detectLiveSessions } from '../../src/main/claude/live/liveSessionDetector'

// Real shapes observed on macOS: the VS Code extension binary, and a plain CLI resume.
const PS = `  PID ARGS
42469 /Users/n/.vscode/extensions/anthropic.claude-code-2.1.258-darwin-arm64/resources/native-binary/claude --output-format stream-json --resume=c8af2f41-ff45-41cc-8d23-0f71067c7865 --permission-mode auto
47736 /Users/n/.vscode/extensions/anthropic.claude-code-2.1.258-darwin-arm64/resources/native-binary/claude --output-format stream-json --permission-mode auto
51001 /home/n/.local/bin/claude --resume 298e0b80-d442-4b41-b3b3-77d3dbf08dd1
52002 /bin/bash -c grep claude something
53003 node /some/other/app.js --resume=deadbeef-0000-0000-0000-000000000000
`

describe('parseLiveSessions', () => {
  it('extracts a session id from --resume=<id>', () => {
    const live = parseLiveSessions(PS)
    expect(live.get('c8af2f41-ff45-41cc-8d23-0f71067c7865')).toBe(42469)
  })

  it('extracts a session id from --resume <id>', () => {
    const live = parseLiveSessions(PS)
    expect(live.get('298e0b80-d442-4b41-b3b3-77d3dbf08dd1')).toBe(51001)
  })

  it('ignores claude processes with no resolvable session id', () => {
    expect(parseLiveSessions(PS).size).toBe(2)
  })

  it('ignores non-claude processes even when they carry --resume', () => {
    const live = parseLiveSessions(PS)
    expect(live.has('deadbeef-0000-0000-0000-000000000000')).toBe(false)
  })

  it('returns an empty map for empty input', () => {
    expect(parseLiveSessions('').size).toBe(0)
  })
})

/**
 * MAIN-23: `detectLiveSessions` now runs `ps` through the shared `exec/run.ts` wrapper via an
 * injectable `exec`, instead of its own `promisify(execFile)`. Pins the one behaviour that must
 * survive the migration: a failed or unavailable `ps` degrades to "nothing is live" rather than
 * throwing and taking a refresh pass down with it.
 */
describe('detectLiveSessions (MAIN-23 exec wrapper)', () => {
  it('degrades to an empty map when the injected exec fails', async () => {
    const live = await detectLiveSessions({ exec: async () => { throw new Error('ps: command not found') } })
    expect(live.size).toBe(0)
  })

  it('calls exec with "ps -eo pid=,args=" and parses its stdout', async () => {
    const live = await detectLiveSessions({
      exec: async (file, args) => {
        expect(file).toBe('ps')
        expect(args).toEqual(['-eo', 'pid=,args='])
        return '42469 /usr/bin/claude --resume=c8af2f41-ff45-41cc-8d23-0f71067c7865\n'
      },
    })
    expect(live.get('c8af2f41-ff45-41cc-8d23-0f71067c7865')).toBe(42469)
  })
})
