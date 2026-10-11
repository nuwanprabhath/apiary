import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const IPC = join(import.meta.dirname, '../../../src/main/ipc')

/** Optional members (`name?:`) of every `…Deps` interface in `src/main/ipc/index.ts` and `handlers/*.ts`. */
function optionalDeps(): string[] {
  const files = ['index.ts', ...readdirSync(join(IPC, 'handlers')).filter((f) => f.endsWith('.ts')).map((f) => `handlers/${f}`)]
  const found: string[] = []
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(join(IPC, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('Deps')) {
        for (const member of node.members) {
          if (member.questionToken !== undefined && member.name !== undefined) found.push(`src/main/ipc/${file} ${node.name.text}.${member.name.getText(source)}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

// What the registrar is handed is required, `X | null` where it does not exist. 1.37.0 shipped with
// `index.ts` handing it no host directory, server or pairing store: the members were optional, so
// leaving them out compiled, the handlers answered "nothing", and every test passed because each
// test built its own registrar.
describe('everything handed to the IPC registrar is required', () => {
  it('no …Deps interface of src/main/ipc has an optional member', () => {
    expect(optionalDeps(), 'Make it required: `name: T | null`, and pass null where it does not exist (src/main/index.ts and the test harnesses then cannot forget it).').toEqual([])
  })
})
