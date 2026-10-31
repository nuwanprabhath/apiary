import { describe, expect, it } from 'vitest'
import { activityForTool, THINKING, WORKING, WRITING } from '../../../src/main/residents/activity'

const titles: Record<string, string> = { s1: 'API auth', s2: 'A session whose title goes on and on and on for ever' }
const titleOf = (id: string): string | null => titles[id] ?? null

describe('activityForTool', () => {
  it('names what each Apiary tool is doing', () => {
    expect(activityForTool('mcp__apiary__find_sessions', { query: 'x' }, titleOf)).toBe('Searching sessions')
    expect(activityForTool('mcp__apiary__session_topics', { sessionId: 's1' }, titleOf)).toBe('Skimming API auth')
    expect(activityForTool('mcp__apiary__read_session', { sessionId: 's1' }, titleOf)).toBe('Reading API auth')
    expect(activityForTool('mcp__apiary__open_session', { sessionId: 's1' }, titleOf)).toBe('Opening API auth')
    expect(activityForTool('mcp__apiary__note_put', { key: 'a', text: 'b' }, titleOf)).toBe('Checking notes')
    expect(activityForTool('mcp__apiary__note_list', {}, titleOf)).toBe('Checking notes')
  })

  it('a session it cannot name is "a session"', () => {
    expect(activityForTool('mcp__apiary__read_session', { sessionId: 'nope' }, titleOf)).toBe('Reading a session')
    expect(activityForTool('mcp__apiary__read_session', {}, titleOf)).toBe('Reading a session')
  })

  it('is cut to 40 characters', () => {
    const text = activityForTool('mcp__apiary__read_session', { sessionId: 's2' }, titleOf)
    expect(text).toHaveLength(40)
    expect(text?.endsWith('…')).toBe(true)
  })

  it('a shell command is "Running" and its first words, without flags or what follows a separator', () => {
    const run = (command: string): string => activityForTool('Bash', { command }, titleOf)
    expect(run('mra prompt 1559 --json')).toBe('Running mra prompt 1559')
    expect(run('glab mr view 12 -F json')).toBe('Running glab mr view')
    expect(run('glab --repo g/p mr list')).toBe('Running glab g/p mr')
    expect(run('sleep 1; echo done')).toBe('Running sleep 1')
    expect(run('git status && git diff')).toBe('Running git status')
    expect(run('ls | head')).toBe('Running ls')
    expect(activityForTool('Bash', {}, titleOf)).toBe('Running a command')
  })

  it('names Claude Code\'s own tools', () => {
    expect(activityForTool('Agent', { description: 'Review MR 1559' }, titleOf)).toBe('Helper: Review MR 1559')
    expect(activityForTool('Task', { description: 'Find usages' }, titleOf)).toBe('Helper: Find usages')
    expect(activityForTool('Agent', {}, titleOf)).toBe('Reviewing with a helper')
    expect(activityForTool('WebSearch', { query: 'x' }, titleOf)).toBe('Searching the web')
    expect(activityForTool('WebFetch', { url: 'https://docs.gitlab.com/api/mrs' }, titleOf)).toBe('Reading docs.gitlab.com')
    expect(activityForTool('WebFetch', { url: 'not a url' }, titleOf)).toBe('Reading the web')
    for (const tool of ['Read', 'Grep', 'Glob']) expect(activityForTool(tool, { file_path: '/a/b.ts' }, titleOf)).toBe('Reading files')
    expect(activityForTool('Edit', { file_path: '/repo/src/app.ts' }, titleOf)).toBe('Editing app.ts')
    expect(activityForTool('Write', { file_path: '/repo/notes.md' }, titleOf)).toBe('Editing notes.md')
  })

  it('another MCP server\'s tool is "Using <server>"; anything else is "Working", never nothing', () => {
    expect(activityForTool('mcp__gitlab__get_merge_request', {}, titleOf)).toBe('Using gitlab')
    expect(activityForTool('mcp__claude_ai_Jira__search', {}, titleOf)).toBe('Using claude_ai_Jira')
    expect(activityForTool('TodoWrite', {}, titleOf)).toBe('Working')
    expect(activityForTool('mcp__apiary__something_new', {}, titleOf)).toBe('Working')
  })

  it('every kind of tool is cut at 40 characters', () => {
    const long = 'x'.repeat(80)
    for (const [name, input] of [['Bash', { command: long }], ['Agent', { description: long }], ['Edit', { file_path: `/a/${long}` }], [`mcp__${long}__t`, {}]] as const) {
      const text = activityForTool(name, input, titleOf)
      expect(text).toHaveLength(40)
      expect(text.endsWith('…')).toBe(true)
    }
  })

  it('thinking is "Thinking" and a turn with nothing more specific is "Working"', () => {
    expect(THINKING).toBe('Thinking')
    expect(WORKING).toBe('Working')
  })

  it('streaming text is "Writing"', () => {
    expect(WRITING).toBe('Writing')
  })
})
