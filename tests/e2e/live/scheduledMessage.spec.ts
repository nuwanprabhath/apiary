import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { launchApiary, importAll, relaunchApiaryAfter, type Harness } from '../helpers'

/**
 * Scheduled messages against a real `claude --model claude-haiku-5-5`, the acceptance test of the
 * feature. A scratch folder gets a real session (`claude -p … "Reply with the word READY"`), then:
 *
 * (a) with Apiary running (an isolated, headless instance over the real `~/.claude`), a message
 *     scheduled a minute ahead reaches the transcript and Claude answers it;
 * (b) with Apiary closed, the launchd job sends the next one with `claude -p`, its LaunchAgent is
 *     gone afterwards, and the next start shows "sent while Apiary was closed" as a notice.
 *
 * Opt-in (`APIARY_LIVE_CLAUDE=1`, macOS): it spends real tokens, registers a real LaunchAgent (which
 * it removes whatever happens) and writes one short session into the real `~/.claude/projects`,
 * removed afterwards. The resumed runs use Haiku through `APIARY_SCHEDULE_MODEL`.
 */
/** Declared only when asked for, so a default run neither registers nor skips anything here. */
const LIVE = process.env.APIARY_LIVE_CLAUDE === '1' && process.platform === 'darwin'

const MODEL = 'claude-haiku-5-5'
const CLAUDE_ROOT = join(homedir(), '.claude')
const LAUNCH_AGENTS = join(homedir(), 'Library', 'LaunchAgents')
const evidence: string[] = []
const say = (line: string): void => { evidence.push(`${new Date().toISOString()} ${line}`) }

/** The session's file, found by its id under any project folder. */
function transcriptOf(sessionId: string): string {
  for (const dir of readdirSync(join(CLAUDE_ROOT, 'projects'))) {
    const file = join(CLAUDE_ROOT, 'projects', dir, `${sessionId}.jsonl`)
    if (existsSync(file)) return file
  }
  throw new Error(`no transcript for ${sessionId}`)
}

/** The user and assistant texts of a transcript, in order. */
function turns(file: string): Array<{ role: string; text: string; at: string }> {
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    if (line.trim() === '') return []
    const e = JSON.parse(line) as { type?: string; timestamp?: string; message?: { content?: unknown } }
    if (e.type !== 'user' && e.type !== 'assistant') return []
    const c = e.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: { text?: string }) => b.text ?? '').join('') : ''
    return text === '' ? [] : [{ role: e.type, text, at: e.timestamp ?? '' }]
  })
}

/** Claude answered `word` after it was sent: a user turn carrying it, then an assistant turn. */
function answered(file: string, word: string): boolean {
  const t = turns(file)
  const asked = t.findIndex((x) => x.role === 'user' && x.text.includes(word))
  return asked !== -1 && t.slice(asked + 1).some((x) => x.role === 'assistant' && x.text.trim() !== '')
}

if (LIVE) defineLiveSchedule()

function defineLiveSchedule(): void {
  test.setTimeout(600_000)
  let h: Harness
  let lab: string
  let sessionId: string

  test.beforeAll(() => {
    mkdirSync('/private/tmp/claude-501', { recursive: true })
    lab = mkdtempSync('/private/tmp/claude-501/apiary-sched-lab-')
    const out = execFileSync('claude', ['-p', '--model', MODEL, '--output-format', 'json', 'Reply with the word READY'], { cwd: lab, encoding: 'utf8', timeout: 180_000 })
    sessionId = (JSON.parse(out) as { session_id: string }).session_id
    say(`session ${sessionId} created in ${lab}: ${turns(transcriptOf(sessionId)).map((t) => `${t.role}: ${t.text}`).join(' | ')}`)
    process.env.APIARY_SCHEDULE_MODEL = MODEL
    process.env.APIARY_OS_SCHEDULER = 'on'
  })

  test.afterAll(async () => {
    for (const f of existsSync(LAUNCH_AGENTS) ? readdirSync(LAUNCH_AGENTS) : []) {
      if (!f.startsWith('com.apiary.scheduled.')) continue
      const id = f.slice('com.apiary.scheduled.'.length, -'.plist'.length)
      // Only this run's jobs: theirs name a userData under this harness's home.
      if (!readFileSync(join(LAUNCH_AGENTS, f), 'utf8').includes(h.home)) continue
      try { execFileSync('launchctl', ['bootout', `gui/${String(process.getuid?.() ?? 0)}/com.apiary.scheduled.${id}`]) } catch { /* not loaded */ }
      rmSync(join(LAUNCH_AGENTS, f), { force: true })
    }
    writeFileSync(test.info().outputPath('evidence.txt'), `${evidence.join('\n')}\n`)
    console.warn(evidence.join('\n'))
    await h.close()
    const file = (() => { try { return transcriptOf(sessionId) } catch { return null } })()
    if (file !== null) rmSync(join(file, '..'), { recursive: true, force: true })
    rmSync(lab, { recursive: true, force: true })
  })

  test('a scheduled message goes out with Apiary open, and through launchd with it closed', async () => {
    h = await launchApiary({ configRoot: CLAUDE_ROOT, claudeBin: null })
    await importAll(h.page)
    const file = transcriptOf(sessionId)

    // (a) Apiary running.
    const atA = Date.now() + 60_000
    await h.page.evaluate(async ({ id, at }) => { await window.apiary.scheduleSet({ id: null, sessionId: id as never, text: 'Reply with the word SCHEDULED-A', at }) }, { id: sessionId, at: atA })
    say(`(a) scheduled for ${new Date(atA).toISOString()}`)
    await expect.poll(() => answered(file, 'SCHEDULED-A'), { timeout: 240_000, intervals: [2000] }).toBe(true)
    const a = turns(file).filter((t) => t.text.includes('SCHEDULED-A') || t.role === 'assistant').slice(-2)
    say(`(a) transcript: ${a.map((t) => `${t.at} ${t.role}: ${t.text}`).join(' | ')}`)
    expect(Date.parse(a[0]?.at ?? '')).toBeGreaterThanOrEqual(atA - 1000)

    // (b) Apiary closed: the LaunchAgent sends.
    const atB = Date.now() + 90_000
    const b = await h.page.evaluate(async ({ id, at }) => window.apiary.scheduleSet({ id: null, sessionId: id as never, text: 'Reply with the word SCHEDULED-B', at }), { id: sessionId, at: atB })
    const plist = join(LAUNCH_AGENTS, `com.apiary.scheduled.${b.id}.plist`)
    expect(existsSync(plist)).toBe(true)
    say(`(b) scheduled ${b.id} for ${new Date(atB).toISOString()}; LaunchAgent written`)
    const done = join(h.home, 'userdata', 'scheduled', `${b.id}.done`)
    await relaunchApiaryAfter(h, async () => {
      expect(existsSync(join(h.home, 'userdata', 'apiary.pid'))).toBe(false)
      say('(b) Apiary closed; apiary.pid removed')
      await expect.poll(() => existsSync(done), { timeout: 300_000, intervals: [2000] }).toBe(true)
      say(`(b) .done: ${readFileSync(done, 'utf8').trim()}`)
      await expect.poll(() => answered(file, 'SCHEDULED-B'), { timeout: 60_000 }).toBe(true)
      const t = turns(file).filter((x) => x.text.includes('SCHEDULED-B') || x.role === 'assistant').slice(-2)
      say(`(b) transcript: ${t.map((x) => `${x.at} ${x.role}: ${x.text}`).join(' | ')}`)
      expect(Date.parse(t[0]?.at ?? '')).toBeGreaterThanOrEqual(atB - 1000)
      await expect.poll(() => existsSync(plist), { timeout: 20_000 }).toBe(false)
      say('(b) LaunchAgent plist removed by the job itself')
    })

    // The next start turns it into a notice in that chat.
    const notices = await h.page.evaluate(async () => (await window.apiary.scheduleList(null)).notices)
    expect(notices).toEqual([expect.objectContaining({ id: b.id, ok: true, whileClosed: true })])
    say(`(b) after relaunch, notice: ${JSON.stringify(notices[0])}`)
  })
}
