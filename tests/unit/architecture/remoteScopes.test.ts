import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { CHANNEL_SCOPES } from '../../../src/main/remote/scopes'

const HANDLERS = join(import.meta.dirname, '../../../src/main/ipc/handlers')

/**
 * Electron APIs that act on the machine the handler runs on: its browser, dialogs, clipboard and
 * windows. A `remote` channel runs on the work machine, whose screen nobody at home can see.
 */
const SCREEN_APIS = new Set(['shell', 'dialog', 'clipboard', 'BrowserWindow', 'nativeTheme', 'screen', 'Notification'])

/** Each handler property of `src/main/ipc/handlers/*.ts` and the screen APIs its body names. */
function handlerScreenUses(): Array<{ file: string; key: string; apis: string[] }> {
  const out: Array<{ file: string; key: string; apis: string[] }> = []
  for (const file of readdirSync(HANDLERS).filter((f) => f.endsWith('.ts'))) {
    const source = ts.createSourceFile(file, readFileSync(join(HANDLERS, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if ((ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) && ts.isIdentifier(node.name) && Object.hasOwn(CHANNEL_SCOPES, node.name.text)) {
        const apis = new Set<string>()
        const body = ts.isPropertyAssignment(node) ? node.initializer : node
        const scan = (n: ts.Node): void => {
          if (ts.isIdentifier(n) && SCREEN_APIS.has(n.text)) apis.add(n.text)
          ts.forEachChild(n, scan)
        }
        scan(body)
        out.push({ file, key: node.name.text, apis: [...apis] })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return out
}

// 1.37.0 shipped two channels scoped `remote` whose handlers act on the screen they run on: a
// plugin's link opened a browser on the unattended work machine (`pluginRunAction`, shell), and a
// click in a remote window's Active section raised a window there (`focusTab`, BrowserWindow).
describe("a remote channel's handler never acts on the work machine's screen", () => {
  const uses = handlerScreenUses()

  it('finds the handlers', () => {
    expect(uses.length).toBeGreaterThan(50)
  })

  it.each(uses.filter((u) => u.apis.length > 0))('$key ($file)', ({ key, file, apis }) => {
    const scope = CHANNEL_SCOPES[key as keyof typeof CHANNEL_SCOPES]
    expect(scope, `${key} (src/main/ipc/handlers/${file}) uses ${apis.join(', ')}, which act on the machine it runs on, but src/main/remote/scopes.ts scopes it 'remote', so a remote window runs it on the work machine's screen. Scope it 'local' (it needs nothing of the work machine's), 'bridged' (home acts on an answer from the work machine) or 'unavailable'.`).not.toBe('remote')
  })
})
