import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { generate, parseArgs, validateName } from '../../scripts/new.mjs'

/**
 * `npm run new -- <kind> <name>` (scripts/new.mjs) is the canonical example an agent copies, so it
 * must keep working as the files it edits change. Each case runs a generator into a temp copy of the
 * real files it anchors on: an anchor that moved fails here, not for the next person to add a call.
 */
const REPO = join(__dirname, '..', '..')
const ANCHOR_FILES = [
  'src/shared/ipc/contract.ts',
  'src/main/ipc/index.ts',
  'tests/component/fakeApiary.ts',
  'tests/contract/bridgeContract.ts',
]

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'apiary-new-'))
  for (const f of ANCHOR_FILES) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    cpSync(join(REPO, f), join(root, f))
  }
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const read = (rel: string): string => readFileSync(join(root, rel), 'utf8')

describe('names are validated', () => {
  it.each(['Foo', '1foo', 'a', 'foo-bar', 'foo_bar', 'foo bar', '../x', 'foo/bar', '', 'x'.repeat(41)])('rejects %j', (name) => {
    expect(() => validateName(name)).toThrow(/not a valid name/)
  })

  it('accepts camelCase', () => {
    expect(validateName('recentFolders')).toBe('recentFolders')
  })

  it('rejects an unknown kind, a missing name and a stray argument', () => {
    expect(() => parseArgs(['widget', 'x1'])).toThrow(/Usage/)
    expect(() => parseArgs(['ipc'])).toThrow(/not a valid name/)
    expect(() => parseArgs(['ipc', 'fooBar', 'extra'])).toThrow(/Unexpected/)
  })

  it('reads --flag value pairs', () => {
    expect(parseArgs(['store', 'fooBar', '--fetch', 'statusBarItems']).flags).toEqual({ fetch: 'statusBarItems' })
    expect(() => parseArgs(['store', 'fooBar', '--fetch'])).toThrow(/needs a value/)
  })
})

describe('ipc', () => {
  it('declares the channel and stubs the handler, the fake and the contract clause, all failing until written', () => {
    const { created, edited } = generate({ kind: 'ipc', name: 'recentFolders', root })
    expect(created.sort()).toEqual(['src/main/ipc/handlers/recentFolders.ts', 'tests/contract/clauses/recentFolders.ts'])
    expect(edited.sort()).toEqual([...ANCHOR_FILES].sort())
    expect(read('src/shared/ipc/contract.ts')).toContain("recentFolders: invoke<[], void>('apiary:recent-folders', tuple()),")
    const index = read('src/main/ipc/index.ts')
    expect(index).toContain("import { recentFoldersHandlers } from './handlers/recentFolders'")
    expect(index).toContain('const recentFoldersIpc = recentFoldersHandlers()')
    expect(index).toContain('...recentFoldersIpc,')
    expect(read('tests/component/fakeApiary.ts')).toContain('recentFolders: () => Promise.reject(')
    const bridge = read('tests/contract/bridgeContract.ts')
    expect(bridge).toContain("import { defineRecentFoldersClauses } from './clauses/recentFolders'")
    expect(bridge).toContain('defineRecentFoldersClauses(ctx)')
    expect(read('tests/contract/clauses/recentFolders.ts')).toContain("describe('recentFolders'")
    expect(read('src/main/ipc/handlers/recentFolders.ts')).toContain('throw new Error')
  })

  it('does not mention the call by name in the contract clause, so the coverage test cannot be satisfied by the stub', () => {
    generate({ kind: 'ipc', name: 'recentFolders', root })
    expect(read('tests/contract/clauses/recentFolders.ts')).not.toMatch(/\.recentFolders\b/)
  })

  it('refuses a channel that exists and a handler file that exists', () => {
    expect(() => generate({ kind: 'ipc', name: 'tree', root })).toThrow(/already declares/)
    generate({ kind: 'ipc', name: 'recentFolders', root })
    expect(() => generate({ kind: 'ipc', name: 'recentFolders', root })).toThrow(/already/)
  })

  it('stops with a message, and edits nothing, when a file no longer has the shape it anchors on', () => {
    writeFileSync(join(root, 'src/main/ipc/index.ts'), 'export {}\n')
    expect(() => generate({ kind: 'ipc', name: 'recentFolders', root })).toThrow(/generator|anchor|handler imports/)
    expect(existsSync(join(root, 'src/main/ipc/handlers/recentFolders.ts'))).toBe(false)
    expect(read('src/shared/ipc/contract.ts')).not.toContain('recentFolders')
  })
})

describe('store', () => {
  it('writes state/<name>Store.ts on createIpcStore and a failing test stub', () => {
    const { created } = generate({ kind: 'store', name: 'recentFolders', flags: { fetch: 'statusBarItems', event: 'onStatusBarChanged' }, root })
    expect(created).toEqual(['src/renderer/state/recentFoldersStore.ts', 'tests/unit/recentFoldersStore.test.ts'])
    const store = read('src/renderer/state/recentFoldersStore.ts')
    expect(store).toContain("ApiaryApi['statusBarItems']")
    expect(store).toContain('createIpcStore<RecentFolders | null>')
    expect(store).toContain('window.apiary.onStatusBarChanged(invalidate)')
    expect(read('tests/unit/recentFoldersStore.test.ts')).toContain('expect.fail(')
  })

  it('needs a real invoke channel to read, and a real event to listen to', () => {
    expect(() => generate({ kind: 'store', name: 'recentFolders', root })).toThrow(/--fetch/)
    expect(() => generate({ kind: 'store', name: 'recentFolders', flags: { fetch: 'noSuchCall' }, root })).toThrow(/not an invoke channel/)
    expect(() => generate({ kind: 'store', name: 'recentFolders', flags: { fetch: 'tree', event: 'onNoSuchEvent' }, root })).toThrow(/no event channel/)
    expect(() => generate({ kind: 'store', name: 'recentFolders', flags: { fetch: 'tree', event: 'onTree' }, root })).toThrow(/no event channel/)
  })

  it('has no subscription of its own when nothing pushes the value', () => {
    generate({ kind: 'store', name: 'recentFolders', flags: { fetch: 'tree' }, root })
    expect(read('src/renderer/state/recentFoldersStore.ts')).toContain('subscribe: () => () => {},')
  })
})

describe('feature', () => {
  it('writes an index, an ErrorBoundary-wrapped root, a view, a CLAUDE.md stub and a failing component test', () => {
    const { created } = generate({ kind: 'feature', name: 'recentFolders', root })
    expect(created.sort()).toEqual([
      'src/renderer/features/recentFolders/CLAUDE.md',
      'src/renderer/features/recentFolders/RecentFoldersRoot.tsx',
      'src/renderer/features/recentFolders/RecentFoldersView.tsx',
      'src/renderer/features/recentFolders/index.ts',
      'tests/component/recentFoldersFeature.test.tsx',
    ])
    expect(read('src/renderer/features/recentFolders/RecentFoldersRoot.tsx')).toContain('<ErrorBoundary label="RecentFolders">')
    expect(read('src/renderer/features/recentFolders/index.ts')).toContain("export { RecentFoldersRoot } from './RecentFoldersRoot'")
    expect(read('tests/component/recentFoldersFeature.test.tsx')).toContain('expect.fail(')
  })

  it('refuses a folder that exists', () => {
    generate({ kind: 'feature', name: 'recentFolders', root })
    expect(() => generate({ kind: 'feature', name: 'recentFolders', root })).toThrow(/already exists/)
  })
})

describe('service', () => {
  it('writes src/main/<name>/<name>Service.ts with injected deps and a failing test stub', () => {
    const { created, next } = generate({ kind: 'service', name: 'recentFolders', root })
    expect(created).toEqual(['src/main/recentFolders/recentFoldersService.ts', 'tests/unit/recentFoldersService.test.ts'])
    const service = read('src/main/recentFolders/recentFoldersService.ts')
    expect(service).toContain('export interface RecentFoldersServiceDeps')
    expect(service).toContain('constructor(deps: RecentFoldersServiceDeps)')
    expect(next).toContain('createContainer')
    expect(next).toContain('construct-in-container')
    expect(read('tests/unit/recentFoldersService.test.ts')).toContain('expect.fail(')
  })

  it('refuses a folder that exists', () => {
    generate({ kind: 'service', name: 'recentFolders', root })
    expect(() => generate({ kind: 'service', name: 'recentFolders', root })).toThrow(/already exists/)
  })
})
