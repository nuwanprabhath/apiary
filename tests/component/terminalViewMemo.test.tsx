/**
 * UI-4 step 5: TerminalView used to re-render on every App/SessionColumn render — up to 2Hz while
 * any pty prints (see the review) — rebuilding its context-menu items and calling `getSelection()`
 * for a component that is hidden almost all of the time (every open tab keeps its terminals
 * mounted; see SessionColumn). It is now wrapped in `memo` with `terminalViewPropsEqual`, tested
 * directly here rather than through a mounted render: a `React.memo` bailout does no render work,
 * so there is nothing a render-count probe placed outside it can reliably observe — the contract
 * that actually matters is this function's own logic. This lives in `tests/component` rather than
 * `tests/unit` only because the module it comes from pulls in `@xterm/xterm` at import time
 * (CLAUDE.md: a renderer module reached from `tests/unit` drags a DOM-less tsconfig into it).
 */
import { describe, it, expect } from 'vitest'
import { asPtyId } from '@shared/domain/ids'
import { terminalViewPropsEqual } from '../../src/renderer/features/terminal/TerminalView'

const base = { ptyId: asPtyId('session-1'), testId: 'terminal-session', visible: true }

describe('terminalViewPropsEqual (UI-4)', () => {
  it('treats two calls as equal when only onRenameKey differs', () => {
    // The exact shape of SessionColumn's own call site: a fresh closure every render.
    expect(terminalViewPropsEqual(
      { ...base, onRenameKey: () => {} },
      { ...base, onRenameKey: () => {} },
    )).toBe(true)
  })

  it('is not fooled by a changed ptyId', () => {
    expect(terminalViewPropsEqual(base, { ...base, ptyId: asPtyId('session-2') })).toBe(false)
  })

  it('is not fooled by a changed testId', () => {
    expect(terminalViewPropsEqual(base, { ...base, testId: 'terminal-shell' })).toBe(false)
  })

  it('is not fooled by a changed visible', () => {
    expect(terminalViewPropsEqual(base, { ...base, visible: false })).toBe(false)
  })

  it('treats an omitted `visible` the same as `visible: true`, matching the component default', () => {
    const { visible: _visible, ...withoutVisible } = base
    expect(terminalViewPropsEqual(withoutVisible, base)).toBe(true)
  })
})
