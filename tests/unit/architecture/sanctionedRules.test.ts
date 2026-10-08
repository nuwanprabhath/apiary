import { describe, it, expect } from 'vitest'
import { Linter } from 'eslint'
import { resolve } from 'node:path'
import tseslint from 'typescript-eslint'
import apiary from '../../../eslint/plugin.js'
import { SANCTIONED } from '../../../eslint/sanctioned.js'

/**
 * The guards are code too: each `apiary/*` rule must fire on the mistake it exists for, stay quiet
 * in its sanctioned home, and stay quiet outside the files it covers. A rule with no case here
 * fails the "every rule has a case" test — the same proof the `correct` skill asks for ("a check
 * that never failed has not been shown to work"), kept, so a later edit to a selector cannot
 * quietly turn a rule into one that matches nothing.
 *
 * The `bad` snippets are the real shapes these rules were written against (file:line in the
 * 2026-10-07 guardrails review), trimmed to the line that matters.
 */
interface Case { bad: { file: string, code: string }, alsoBad?: { file: string, code: string }[], allowed?: { file: string, code: string }, outside?: { file: string, code: string } }

const CASES: Record<string, Case> = {
  'no-raw-subprocess': {
    bad: { file: 'src/main/chat/chatManager.ts', code: "import { spawn } from 'node:child_process'\nspawn('x')" },
    allowed: { file: 'src/main/exec/run.ts', code: "import { execFile } from 'node:child_process'\nexecFile('x')" },
    outside: { file: 'src/renderer/x.ts', code: "import { spawn } from 'node:child_process'\nspawn('x')" },
  },
  'no-raw-state-write': {
    bad: { file: 'src/main/pets/petStore.ts', code: "import { writeFileSync } from 'node:fs'\nwriteFileSync('a', 'b')" },
    allowed: { file: 'src/main/fs/atomicWrite.ts', code: "import { writeFileSync } from 'node:fs'\nwriteFileSync('a', 'b')" },
    outside: { file: 'src/main/x.ts', code: "import { readFileSync } from 'node:fs'\nreadFileSync('a')" },
  },
  'confine-via-real-path': {
    bad: { file: 'src/main/media/imageStore.ts', code: "import { resolve, sep } from 'node:path'\ndeclare const dir: string\nconst full = resolve('x')\nif (!full.startsWith(dir + sep)) throw new Error('out')" },
    allowed: { file: 'src/main/fs/confine.ts', code: "import { relative } from 'node:path'\nrelative('a', 'b')" },
    outside: { file: 'src/main/x.ts', code: "declare const name: string\nname.startsWith('.')" },
  },
  'no-short-refnames': {
    // branchOps.ts before B20: the format string whose `origin/HEAD` came out as a bare `origin` on git 2.48.
    bad: { file: 'src/main/git/branchOps.ts', code: "const args = ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/']\nvoid args" },
    alsoBad: [
      { file: 'src/main/git/branchOps.ts', code: "const args = ['rev-parse', '--abbrev-ref', 'HEAD']\nvoid args" },
      { file: 'src/main/git/worktreeResolver.ts', code: "const args = ['symbolic-ref', '-q', '--short', 'HEAD']\nvoid args" },
      { file: 'src/main/git/branchOps.ts', code: "const args = ['for-each-ref', '--format=%(upstream:short)\\t%(upstream:track,nobracket)']\nvoid args" },
    ],
    allowed: { file: 'src/main/git/refs.ts', code: "const f = '%(refname:short)'\nvoid f" },
    outside: { file: 'src/main/git/branchOps.ts', code: "const f = ['rev-parse', '--short', 'HEAD']\nconst g = '%(objectname:short)'\nvoid f\nvoid g" },
  },
  'ipc-through-registrar': {
    bad: { file: 'src/main/x.ts', code: "import { ipcMain } from 'electron'\nipcMain.handle('c', () => 1)" },
    allowed: { file: 'src/main/ipc/registrar.ts', code: "import { ipcMain } from 'electron'\nipcMain.handle('c', () => 1)" },
    outside: { file: 'src/main/x.ts', code: "import { app } from 'electron'\napp.quit()" },
  },
  'send-through-windows': {
    bad: { file: 'src/main/index.ts', code: "declare const win: any\nwin.webContents.send('c')" },
    allowed: { file: 'src/main/windows/broadcast.ts', code: "declare const win: any\nwin.webContents.send('c')" },
  },
  'no-unchecked-senders-in-app': {
    bad: { file: 'src/main/index.ts', code: "import { UNCHECKED_SENDERS } from './ipc/ipcSenderGuard'\nconsole.log(UNCHECKED_SENDERS)" },
    outside: { file: 'src/main/index.ts', code: "import { isTrustedSender } from './ipc/ipcSenderGuard'\nconsole.log(isTrustedSender)" },
  },
  'construct-in-container': {
    bad: { file: 'src/main/pets/petService.ts', code: 'declare class ClaudeOneShot {}\nnew ClaudeOneShot()' },
    allowed: { file: 'src/main/app/container.ts', code: 'declare class ClaudeOneShot {}\nnew ClaudeOneShot()' },
  },
  'credentials-behind-consent': {
    // The shape of the mistake: a second reader of Claude Code's token, bypassing the consent gate.
    bad: { file: 'src/main/git/mrStatusCache.ts', code: "const item = 'Claude Code-credentials'\nvoid item" },
    allowed: { file: 'src/main/statusBar/claudeUsage/credentials.ts', code: "const item = 'Claude Code-credentials'\nvoid item" },
    outside: { file: 'tests/unit/claudeUsage.test.ts', code: "const url = 'https://api.anthropic.com/api/oauth/usage'\nvoid url" },
  },
  'consent-minted-by-store': {
    bad: { file: 'src/main/statusBar/claudeUsage/plugin.ts', code: 'interface Consent { readonly x: true }\nconst c = {} as Consent\nvoid c' },
    allowed: { file: 'src/main/statusBar/claudeUsage/consent.ts', code: 'interface Consent { readonly x: true }\nconst c = {} as Consent\nvoid c' },
  },
  'bridge-via-state': {
    bad: { file: 'src/renderer/features/pets/PetChat.tsx', code: 'declare const window: any\nwindow.apiary.petsState()' },
    allowed: { file: 'src/renderer/state/chatStore.ts', code: 'declare const window: any\nwindow.apiary.chatState()' },
  },
  'stores-via-factory': {
    bad: { file: 'src/renderer/state/toolIoView.ts', code: "import { useSyncExternalStore } from 'react'\nuseSyncExternalStore(() => () => undefined, () => 1)" },
    allowed: { file: 'src/renderer/state/createLocalStore.ts', code: "import { useSyncExternalStore } from 'react'\nuseSyncExternalStore(() => () => undefined, () => 1)" },
    outside: { file: 'src/renderer/features/x.tsx', code: "import { useState } from 'react'\nuseState(1)" },
  },
  'no-polling-in-features': {
    bad: { file: 'src/renderer/features/pets/useHabitat.ts', code: 'window.setInterval(() => {}, 1000)' },
    allowed: { file: 'src/renderer/state/mrStatusStore.ts', code: 'setInterval(() => {}, 1000)' },
  },
  'workspace-via-selector': {
    bad: { file: 'src/renderer/features/pane/useShellTerminals.ts', code: 'declare function useWorkspace(): { shellTabs: Map<string, string> }\nconst { shellTabs } = useWorkspace()' },
    allowed: { file: 'src/renderer/features/workspace/useTabTransfer.ts', code: 'declare function useWorkspace(): { layout: object }\nconst { layout } = useWorkspace()' },
    outside: { file: 'src/renderer/features/pane/usePaneWorkspace.ts', code: 'declare function useWorkspaceSelector<T>(s: (x: object) => T): T\nuseWorkspaceSelector(() => 1)' },
  },
  'no-raw-storage': {
    bad: { file: 'src/renderer/features/transcript/Composer.tsx', code: "localStorage.getItem('apiary.composerHeight')" },
    allowed: { file: 'src/renderer/state/uiState.ts', code: "localStorage.getItem('apiary.ui')" },
    outside: { file: 'src/renderer/x.ts', code: 'const localStorage = { getItem: (_k: string) => null }\nlocalStorage.getItem("k")' },
  },
  'paste-via-terminal-paste': {
    bad: { file: 'src/renderer/features/terminal/TerminalView.tsx', code: 'declare const term: { paste: (t: string) => void }\nterm.paste(\'x\')' },
    allowed: { file: 'src/renderer/features/terminal/terminalPaste.ts', code: "declare const host: HTMLElement\nhost.addEventListener('paste', () => {}, true)" },
    outside: { file: 'src/renderer/features/transcript/Composer.tsx', code: "declare const host: HTMLElement\nhost.addEventListener('click', () => {})" },
  },
  'icons-from-ui': {
    bad: { file: 'src/renderer/features/chat/ModeMenu.tsx', code: 'const x = <svg viewBox="0 0 1 1" />' },
    allowed: { file: 'src/renderer/ui/icons.tsx', code: 'const x = <svg viewBox="0 0 1 1" />' },
  },
  'roles-via-primitives': {
    bad: { file: 'src/renderer/features/chat/ModelPicker.tsx', code: 'const x = <div role="menu" />' },
    allowed: { file: 'src/renderer/ui/Menu.tsx', code: 'const x = <div role="menu" />' },
    outside: { file: 'src/renderer/features/x.tsx', code: 'const x = <div role="status" />' },
  },
  'role-button-is-operable': {
    bad: { file: 'src/renderer/features/pets/PetLayer.tsx', code: 'const x = <div role="button" aria-label="Pip" onPointerDown={() => {}} />' },
    allowed: { file: 'src/renderer/ui/Thing.tsx', code: 'const x = <div role="button" />' },
    outside: { file: 'src/renderer/features/pets/PetLayer.tsx', code: 'const x = <div role="button" tabIndex={0} onKeyDown={() => {}} />\nconst y = <button role="button" />' },
  },
  'drag-via-use-resize-drag': {
    bad: { file: 'src/renderer/features/layout/useResizeDrag.ts', code: 'declare const el: HTMLElement\nel.setPointerCapture(1)' },
    allowed: { file: 'src/renderer/ui/useResizeDrag.ts', code: "window.addEventListener('mousemove', () => {})" },
  },
  'outside-dismiss-via-ui': {
    bad: { file: 'src/renderer/features/pets/PetChat.tsx', code: "document.addEventListener('pointerdown', () => {})" },
    allowed: { file: 'src/renderer/ui/ContextMenu.tsx', code: "document.addEventListener('mousedown', () => {})" },
  },
  'focus-unless-typing': {
    bad: {
      file: 'src/renderer/features/chat/PermissionCard.tsx',
      code: "declare const allowRef: { current: HTMLButtonElement | null }\ndeclare function useEffect(f: () => void, deps: unknown[]): void\nuseEffect(() => { allowRef.current?.focus({ preventScroll: true }) }, [])",
    },
    allowed: { file: 'src/renderer/ui/Modal.tsx', code: 'const x = <input autoFocus />' },
    outside: {
      file: 'src/renderer/features/chat/PermissionCard.tsx',
      code: "declare const ref: { current: HTMLElement | null }\ndeclare function useEffect(f: () => void, deps: unknown[]): void\nuseEffect(() => { ref.current?.focus() }, [open])",
    },
  },
  'branded-ids-from-source': {
    bad: { file: 'src/renderer/features/transcript/Composer.tsx', code: "import { asSessionId } from '@shared/domain/ids'\nasSessionId('x')" },
    allowed: { file: 'src/renderer/state/chatStore.ts', code: "import { asSessionId } from '@shared/domain/ids'\nasSessionId('x')" },
  },
  'no-void-bridge-call': {
    bad: { file: 'src/renderer/state/x.ts', code: "declare const window: any\nvoid window.apiary.petUpdate('id', {})" },
    allowed: { file: 'src/renderer/ui/fireAndForget.ts', code: "declare const window: any\nvoid window.apiary.logWrite('warn')" },
  },
  'no-global-seams': {
    bad: { file: 'src/renderer/features/pets/brainClient.ts', code: "const o = (globalThis as Record<string, unknown>).__apiaryPetBrainOptions" },
    allowed: { file: 'src/renderer/state/testSeams.ts', code: "const o = (globalThis as Record<string, unknown>).__apiaryPetBrainOptions" },
    outside: { file: 'src/renderer/features/pets/x.ts', code: 'const o = globalThis.crypto' },
  },
  'no-silent-catch': {
    bad: { file: 'src/renderer/features/pets/PetLayer.tsx', code: 'declare const p: Promise<void>\np.catch(() => {})' },
    outside: { file: 'src/main/x.ts', code: "declare const p: Promise<void>\nimport { log } from './log'\np.catch((e: unknown) => { log('x', String(e)) })" },
  },
  'error-message-helper': {
    bad: { file: 'src/main/pets/petService.ts', code: 'declare const e: unknown\nconst m = e instanceof Error ? e.message : String(e)' },
    allowed: { file: 'src/shared/errors.ts', code: 'declare const e: unknown\nconst m = e instanceof Error ? e.message : String(e)' },
  },
  'tab-view-type': {
    bad: { file: 'src/renderer/features/layout/columns.ts', code: "export interface OpenTab { key: string, view: 'transcript' | 'terminal' }" },
    allowed: { file: 'src/shared/domain/tabs.ts', code: "export type TabView = 'transcript' | 'terminal'" },
    outside: { file: 'tests/unit/x.test.ts', code: "type Mode = 'transcript' | 'terminal'" },
  },
  'no-cast-through-unknown': {
    bad: { file: 'src/main/ipc/handlers/pets.ts', code: 'declare const patch: object\nconst r = patch as unknown as Record<string, unknown>' },
    outside: { file: 'src/main/x.ts', code: 'declare const v: unknown\nconst r = v as Record<string, unknown>' },
  },
  'no-test-sleep': {
    bad: { file: 'tests/component/petLayer.test.tsx', code: 'await new Promise((r) => setTimeout(r, 5000))' },
    // The other spellings of the same sleep: a block-bodied executor, a `window.`/`globalThis.` call, and the timers/promises import.
    alsoBad: [
      { file: 'tests/component/treeStoreDedup.test.tsx', code: 'await new Promise((r) => { setTimeout(r, 50) })' },
      { file: 'tests/component/sidebar.test.tsx', code: 'await new Promise((resolve) => window.setTimeout(resolve, 300))' },
      { file: 'tests/integration/ptyManager.test.ts', code: "import { setTimeout as sleep } from 'node:timers/promises'\nawait sleep(300)" },
    ],
    allowed: { file: 'tests/fixtures/stays.ts', code: 'await new Promise((resolve) => setTimeout(resolve, 50))' },
    outside: { file: 'src/main/x.ts', code: 'await new Promise((r) => setTimeout(r, 5))' },
  },
  'shared-alias-in-tests': {
    bad: { file: 'tests/unit/chatProtocol.test.ts', code: "import { x } from '../../src/shared/chatTimeline'\nx()" },
    outside: { file: 'tests/unit/chatProtocol.test.ts', code: "import { x } from '@shared/chatTimeline'\nx()" },
  },
}

const ROOT = resolve(__dirname, '../../..')

function lint(name: string, file: string, code: string): string[] {
  const linter = new Linter({ cwd: ROOT, configType: 'flat' })
  const messages = linter.verify(code, [{
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { apiary },
    rules: { [`apiary/${name}`]: 'error' },
  }], resolve(ROOT, file))
  const fatal = messages.find((m) => m.fatal)
  if (fatal) throw new Error(`${file}: ${fatal.message}`)
  return messages.map((m) => m.ruleId ?? '')
}

describe('apiary/* sanctioned-way rules', () => {
  it('every rule has a case here', () => {
    expect(SANCTIONED.map((d) => d.name).filter((n) => !(n in CASES))).toEqual([])
  })

  for (const def of SANCTIONED) {
    const c = CASES[def.name]
    if (!c) continue
    describe(`apiary/${def.name}`, () => {
      it('fires on the mistake it was written for', () => {
        expect(lint(def.name, c.bad.file, c.bad.code)).toContain(`apiary/${def.name}`)
        for (const also of c.alsoBad ?? []) expect(lint(def.name, also.file, also.code)).toContain(`apiary/${def.name}`)
      })
      if (c.allowed) {
        const allowed = c.allowed
        it('is quiet in its sanctioned home', () => {
          expect(lint(def.name, allowed.file, allowed.code)).toEqual([])
        })
      }
      if (c.outside) {
        const outside = c.outside
        it('is quiet where it does not apply', () => {
          expect(lint(def.name, outside.file, outside.code)).toEqual([])
        })
      }
      it('names a replacement in its message', () => {
        expect(def.message.length).toBeGreaterThan(40)
      })
    })
  }
})
