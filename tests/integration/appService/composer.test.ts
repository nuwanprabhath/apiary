import { asSessionId } from '@shared/domain/ids'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { AppService } from '../../../src/main/appService'
import { makeSession } from '../../fixtures/makeSession'
import { createServiceFixture, teardownServiceFixture } from './setup'

let home: string
let workdir: string
let service: AppService

beforeEach(() => {
  ;({ home, workdir, service } = createServiceFixture())
})
afterEach(async () => {
  await teardownServiceFixture({ home, workdir, service })
})

const projects = (): string => join(home, '.claude', 'projects')
describe('composer: images and prompt delivery', () => {
  const tinyPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('saves a pasted image and reads it back as a data URL', async () => {
    const path = await service.saveImage(tinyPng, 'image/png')
    expect(path.endsWith('.png')).toBe(true)
    expect(existsSync(path)).toBe(true)

    const read = await service.readImage(path)
    expect(read?.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    // Round-trips byte for byte: the thumbnail is the image that was pasted, not a re-encoding.
    expect(read?.dataUrl.split(',')[1]).toBe(tinyPng)
  })

  it('refuses an image type it has no extension for, rather than guessing one', async () => {
    await expect(service.saveImage(tinyPng, 'image/svg+xml')).rejects.toThrow(/Unsupported image type/)
  })

  it('will not read a file outside its own images directory', async () => {
    // The renderer supplies these paths, so this is a trust boundary, not a tidiness rule: an
    // unconstrained "read any file as a data URL" would be a way to exfiltrate anything the app
    // can see. `..` must not climb out of it either.
    const outside = join(home, 'secret.png')
    writeFileSync(outside, Buffer.from(tinyPng, 'base64'))
    expect(await service.readImage(outside)).toBeNull()

    const inside = await service.saveImage(tinyPng, 'image/png')
    const climbing = join(dirname(inside), '..', '..', 'secret.png')
    expect(await service.readImage(climbing)).toBeNull()
  })

  it('delivers a multi-line prompt as one paste, so it is not submitted a line at a time', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])
    await service.openShell(asSessionId('11111111-1111-1111-1111-111111111111'), '1')
    const ptyId = 'shell:11111111-1111-1111-1111-111111111111:1'

    const chunks: string[] = []
    service.pty.onData((id, data) => { if (id === ptyId) chunks.push(data) })
    await service.sendPrompt(ptyId, 'echo APIARY_LINE_ONE\necho APIARY_LINE_TWO')

    // A real shell, receiving a real bracketed paste: both lines arrive, and the trailing return
    // is what runs them. If the paste markers were missing, the first newline would submit on its
    // own and the second line would be typed at a fresh prompt instead.
    await vi.waitFor(() => {
      const seen = chunks.join('')
      expect(seen).toContain('APIARY_LINE_ONE')
      expect(seen).toContain('APIARY_LINE_TWO')
    }, { timeout: 15000 })
  })

  it('refuses to send to a session that is not running', async () => {
    await expect(service.sendPrompt('shell:nope:1', 'hello')).rejects.toThrow(/not running/i)
  })

  it('waits for a slow-starting TUI, so the prompt is not eaten by the line discipline', async () => {
    // The bug this covers: sending a message resumes a stopped session first, and the pty exists a
    // good second before `claude` is listening. Written into that gap, the prompt is handled by the
    // terminal's line discipline instead of the program — which buffers it and, fatally, translates
    // the submitting carriage return into a newline (ICRNL). The message then appears in the input
    // box and just sits there, needing an Enter by hand. Reproduced against the real `claude` before
    // this was fixed; this stand-in is that behaviour without the API calls: quiet and in canonical
    // mode at first, then taking the screen and switching to raw mode the way a full-screen program
    // does, recording what it is actually handed.
    const received = join(home, 'tui-received.log')
    const fakeTui = join(home, 'fake-tui.cjs')
    writeFileSync(fakeTui, `
      const fs = require('fs')
      setTimeout(() => {
        process.stdin.setRawMode(true)
        process.stdout.write('\\u001b[?1049h')
        process.stdin.on('data', (d) => fs.appendFileSync(${JSON.stringify(received)}, d.toString('binary')))
      }, 600)
      setTimeout(() => process.exit(0), 10000)
    `)

    service.pty.spawn({
      id: 'tui-probe',
      cwd: workdir,
      command: `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeTui)}`,
      tui: true,
    })
    await service.sendPrompt('tui-probe', 'line one\nline two')

    await vi.waitFor(() => {
      const seen = readFileSync(received, 'latin1')
      // The paste arrived whole, as a paste...
      expect(seen).toContain('\x1b[200~line one\nline two\x1b[201~')
      // ...and the send is a carriage return. A newline here means it was written before the
      // program was listening and the line discipline rewrote it — the original bug exactly.
      expect(seen.endsWith('\r')).toBe(true)
    }, { timeout: 5000 })
    service.pty.kill('tui-probe')
  }, 15000)

  it('strips an ESC[201~ already in the prompt, so it cannot close the bracketed paste early (SEC-6)', async () => {
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Paste bypass',
    })
    await service.refresh()
    await service.importSessions(['22222222-2222-2222-2222-222222222222'], [])
    await service.openShell(asSessionId('22222222-2222-2222-2222-222222222222'), '1')
    const ptyId = 'shell:22222222-2222-2222-2222-222222222222:1'

    // A hostile payload that tries to close the bracketed paste itself, so what follows would run
    // as typed keystrokes rather than arriving as literal pasted text. Captured at the point it
    // reaches the pty, rather than by observing the shell's behaviour, which is what `sendPrompt`
    // itself controls and the one place SEC-6's fix has to take effect.
    const written: string[] = []
    vi.spyOn(service.pty, 'write').mockImplementation((id, data) => { if (id === ptyId) written.push(data) })
    await service.sendPrompt(ptyId, 'hi\x1b[201~\r!echo pwned')

    const all = written.join('')
    expect(all).not.toContain('\x1b[201~\r!echo pwned')
    // Exactly the one closing marker `sendPrompt` itself wraps the prompt in — none from the payload.
    expect(all.split('\x1b[201~').length - 1).toBe(1)
  })
})
