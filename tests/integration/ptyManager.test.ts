import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PtyManager } from '../../src/main/pty/ptyManager'

let manager: PtyManager | null = null
afterEach(async () => { await manager?.killAll(); manager = null })

function collect(m: PtyManager, id: string, until: RegExp, timeoutMs = 10000): Promise<string> {
  return new Promise((res, rej) => {
    let buffer = ''
    const timer = setTimeout(() => rej(new Error(`timeout, saw: ${buffer}`)), timeoutMs)
    m.onData((gotId, data) => {
      if (gotId !== id) return
      buffer += data
      if (until.test(buffer)) { clearTimeout(timer); res(buffer) }
    })
  })
}

describe('PtyManager', () => {
  it('spawns a process in the requested cwd and streams its output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-pty-'))
    try {
      manager = new PtyManager()
      const done = collect(manager, 'a', /APIARY_OK/)
      manager.spawn({ id: 'a', cwd: dir, command: 'echo APIARY_OK' })
      expect(await done).toMatch(/APIARY_OK/)
      // resolve() normalises the /private prefix macOS adds to /tmp.
      expect(resolve(dir)).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not pass another Claude session\'s markers on to the sessions it starts', async () => {
    // Apiary started from a terminal Claude Code opened inherits that session's markers, and a
    // `claude` that sees CLAUDE_CODE_CHILD_SESSION writes no transcript at all — so its tab could
    // never be matched to a session. Real configuration such as CLAUDE_CODE_USE_BEDROCK stays.
    const dir = mkdtempSync(join(tmpdir(), 'apiary-pty-'))
    const saved = { ...process.env }
    try {
      process.env.CLAUDE_CODE_CHILD_SESSION = '1'
      process.env.CLAUDE_CODE_SESSION_ID = 'someone-elses-session'
      process.env.CLAUDECODE = '1'
      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      manager = new PtyManager()
      const done = collect(manager, 'env', /APIARY_ENV_END/)
      manager.spawn({
        id: 'env', cwd: dir,
        command: 'echo "child=[$CLAUDE_CODE_CHILD_SESSION] sid=[$CLAUDE_CODE_SESSION_ID] cc=[$CLAUDECODE] bedrock=[$CLAUDE_CODE_USE_BEDROCK]"; echo APIARY_ENV_END',
      })
      const out = await done
      expect(out).toContain('child=[] sid=[] cc=[] bedrock=[1]')
    } finally {
      process.env = saved
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs the command in the given directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-pty-'))
    try {
      manager = new PtyManager()
      const done = collect(manager, 'b', /APIARY_CWD:/)
      manager.spawn({ id: 'b', cwd: dir, command: 'echo APIARY_CWD:$(pwd -P)' })
      const out = await done
      expect(out).toContain(resolve(dir).replace(/^\/private/, ''))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports exit and forgets the session', async () => {
    manager = new PtyManager()
    const m = manager
    const exited = new Promise<number>((res) => m.onExit((id, code) => { if (id === 'c') res(code) }))
    m.spawn({ id: 'c', cwd: process.cwd(), command: 'exit 3' })
    expect(await exited).toBe(3)
    expect(m.has('c')).toBe(false)
  })

  it('a pty that exits on its own releases its screen, not just its process (MAIN-6)', async () => {
    // Before this, only `kill()` disposed the headless `Terminal` behind `screen()`/`snapshot()`
    // — a pty that exited by itself (the common case: Claude finishing, a shell's command
    // finishing) left it behind. Every `new:<uuid>` id is minted once and never reused, so this
    // leaked one Terminal (up to 1,000 lines of scrollback) per session that ever exited normally.
    manager = new PtyManager()
    const m = manager
    // Both listeners attached before spawn, so neither can race the child's own exit.
    const done = collect(m, 'selfexit', /APIARY_BEFORE_EXIT/)
    const exited = new Promise<void>((res) => m.onExit((id) => { if (id === 'selfexit') res() }))
    m.spawn({ id: 'selfexit', cwd: process.cwd(), command: 'echo APIARY_BEFORE_EXIT; exit 0' })
    await done
    await exited
    expect(m.screen('selfexit')).toBe('')
  })

  it('throws when the cwd does not exist', () => {
    manager = new PtyManager()
    expect(() => manager!.spawn({ id: 'd', cwd: '/definitely/not/here', command: 'true' }))
      .toThrow(/does not exist/i)
  })

  it('accepts writes and resizes without throwing', async () => {
    manager = new PtyManager()
    const done = collect(manager, 'e', /APIARY_ECHO/)
    manager.spawn({ id: 'e', cwd: process.cwd(), command: 'read x; echo APIARY_ECHO$x' })
    manager.resize('e', 100, 30)
    manager.write('e', 'hello\n')
    expect(await done).toMatch(/APIARY_ECHO/)
  })

  it('clamps a NaN or out-of-range resize instead of passing it through (SEC-8)', async () => {
    // A bad renderer message used to reach node-pty's own resize (and the headless screen buffer
    // it feeds) unclamped: `Math.max(1, NaN)` is `NaN`, and there was no upper bound at all.
    manager = new PtyManager()
    const done = collect(manager, 'f', /APIARY_ECHO/)
    manager.spawn({ id: 'f', cwd: process.cwd(), command: 'read x; echo APIARY_ECHO$x' })
    expect(() => { manager!.resize('f', NaN, NaN) }).not.toThrow()
    expect(() => { manager!.resize('f', 1e9, 1e9) }).not.toThrow()
    expect(() => { manager!.resize('f', -5, -5) }).not.toThrow()
    manager.write('f', 'hello\n')
    expect(await done).toMatch(/APIARY_ECHO/)
  })

  // killAll() sends SIGHUP (node-pty's default kill signal on POSIX) and waits for the real
  // `onExit`, bounded by a per-process timeout, so a process that ignores the signal can't wedge
  // app quit forever. This spawns a shell that traps and ignores both SIGHUP and SIGTERM (the
  // signals killAll()/kill() can plausibly send) so it never exits on its own, then asserts
  // killAll() still resolves — via its timeout escape hatch — well within a bounded window.
  it('resolves killAll() within a bounded time even when a PTY ignores the kill signal', async () => {
    manager = new PtyManager()
    const ready = collect(manager, 'f', /APIARY_TRAPPED/)
    manager.spawn({
      id: 'f',
      cwd: process.cwd(),
      command: "trap '' SIGHUP; trap '' SIGTERM; echo APIARY_TRAPPED; sleep 30",
    })
    await ready // don't race killAll() against the traps not being installed yet

    const start = Date.now()
    await manager.killAll()
    const elapsed = Date.now() - start

    // killAll()'s default per-process timeout is 1500ms; a signal-ignoring child must still
    // cause killAll() to resolve, not hang. 3000ms leaves ample headroom above the constant so
    // this isn't flaky under CI load while still catching a regression that removes the timeout.
    expect(elapsed).toBeLessThan(3000)
  }, 10000)

  // TerminalView can mount onto an already-running pty (a tab switch back) whose real size is
  // unchanged from what the pty already has. The kernel only raises SIGWINCH when TIOCSWINSZ
  // actually changes the size, so a plain resize() call to the same size is normally a silent
  // no-op and a readline-based shell never redraws. PtyManager.resize() must detect that and
  // force a real kernel-level size change (and back) so a genuine SIGWINCH still reaches the
  // child. Trap SIGWINCH in the child shell and echo a marker so the redraw is observable.
  it('delivers a real SIGWINCH when resized to its current size, so an unchanged-size resize still redraws', async () => {
    manager = new PtyManager()
    const m = manager
    const ready = collect(m, 'g', /APIARY_READY/)
    m.spawn({
      id: 'g',
      cwd: process.cwd(),
      // Bash only runs a pending trap once it regains control from a foreground child, and how
      // promptly that happens varies by version (observed directly on this machine: bash 3.2
      // ran a WINCH trap immediately while blocked in the `read` builtin, but bash 5.3 did not
      // run it at all until the builtin returned). Looping a short `sleep` bounds that gap to
      // the sleep's own duration on any bash version, so the trap fires quickly and reliably
      // regardless of which one `$SHELL`/`/bin/bash` resolves to.
      command: "trap 'echo APIARY_WINCH' WINCH; echo APIARY_READY; while true; do sleep 0.05; done",
      cols: 100,
      rows: 30,
    })
    await ready // don't race resize() against the trap not being installed yet

    const winched = collect(m, 'g', /APIARY_WINCH/, 3000)
    // Same size as spawn — a genuine no-op from the OS's point of view.
    m.resize('g', 100, 30)
    expect(await winched).toMatch(/APIARY_WINCH/)
  }, 10000)
})
