#!/usr/bin/env node
// The generators behind CLAUDE.md's "How to add…" recipes: `npm run new -- <kind> <name> [flags]`.
//
// Kinds:
//   ipc <name>                       a contract channel and every place it must appear
//   store <name> --fetch <call> [--event <onCall>]   a renderer store on createIpcStore
//   feature <name>                   a renderer feature folder
//   service <name>                   a main-process service
//
// Rule for every kind: a generated stub may be red, never green-but-wrong. What cannot be filled in
// by the generator is a failing test or a compile error, so an unfinished stub cannot be committed
// by accident (pre-push runs typecheck, lint and the unit tests).
//
// `--root <dir>` generates somewhere else (the generator's own test does). No dependencies.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KINDS = ['ipc', 'store', 'feature', 'service']

class UsageError extends Error {}

const fail = (message) => { throw new UsageError(message) }

/** A camelCase identifier that is safe as a file name, a channel key and a symbol. */
export function validateName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-zA-Z0-9]{1,39}$/.test(name)) {
    fail(`"${String(name)}" is not a valid name: use camelCase, 2-40 letters and digits, starting with a lower-case letter (for example "recentFolders").`)
  }
  return name
}

const pascal = (name) => name[0].toUpperCase() + name.slice(1)
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** Parses `[kind, name, ...flags]`. Flags are `--key value`. */
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) fail(`${a} needs a value.`)
      flags[a.slice(2)] = value
      i++
    } else positional.push(a)
  }
  const [kind, name, ...rest] = positional
  if (!KINDS.includes(kind)) fail(`Usage: npm run new -- <${KINDS.join('|')}> <name>. Got "${String(kind)}".`)
  if (rest.length > 0) fail(`Unexpected argument "${rest[0]}".`)
  return { kind, name: validateName(name), flags }
}

class Out {
  constructor(root) {
    this.root = root
    this.created = []
    this.edited = []
  }

  path(rel) { return join(this.root, rel) }

  /** Writes a new file; refuses to overwrite one. */
  create(rel, content) {
    const full = this.path(rel)
    if (existsSync(full)) fail(`${rel} already exists; pick another name or edit it by hand.`)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
    this.created.push(rel)
  }

  read(rel) {
    const full = this.path(rel)
    if (!existsSync(full)) fail(`${rel} is missing under ${this.root}.`)
    return readFileSync(full, 'utf8')
  }

  /** Replaces `anchor` (which must occur exactly once) with `replacement`. */
  edit(rel, text, anchor, replacement) {
    const at = text.indexOf(anchor)
    if (at === -1 || text.indexOf(anchor, at + 1) !== -1) {
      fail(`${rel}: the anchor ${JSON.stringify(anchor.trim().slice(0, 60))} was not found exactly once, so the generator cannot edit this file. Update scripts/new.mjs to the file's new shape.`)
    }
    return text.replace(anchor, () => replacement)
  }

  write(rel, text) {
    writeFileSync(this.path(rel), text)
    this.edited.push(rel)
  }

  assertFree(rel) {
    if (existsSync(this.path(rel))) fail(`${rel} already exists; pick another name or edit it by hand.`)
  }
}

const IPC_KEYS = /^ {2}(\w+): (invoke|invokeLoose|send|sendLoose|event|sync)\b/gm

// ── ipc ──────────────────────────────────────────────────────────────────────────────────────────
function genIpc(out, name) {
  const CONTRACT = 'src/shared/ipc/contract.ts'
  const INDEX = 'src/main/ipc/index.ts'
  const FAKE = 'tests/component/fakeApiary.ts'
  const BRIDGE = 'tests/contract/bridgeContract.ts'
  const handlerFile = `src/main/ipc/handlers/${name}.ts`
  const clauseFile = `tests/contract/clauses/${name}.ts`
  const Name = pascal(name)

  let contract = out.read(CONTRACT)
  if ([...contract.matchAll(IPC_KEYS)].some((m) => m[1] === name)) fail(`${CONTRACT} already declares "${name}".`)
  out.assertFree(handlerFile)
  out.assertFree(clauseFile)
  let index = out.read(INDEX)
  let fake = out.read(FAKE)
  let bridge = out.read(BRIDGE)

  contract = out.edit(CONTRACT, contract, '\n} as const\n\ntype Spec',
    `\n  // Declare the real arguments (a Guard each) and the result, and move the entry next to its neighbours.\n  ${name}: invoke<[], void>('apiary:${kebab(name)}', tuple()),\n} as const\n\ntype Spec`)

  const lastHandlerImport = [...index.matchAll(/^import \{[^}]*\} from '\.\/handlers\/[^']+'\n/gm)].pop()
  if (lastHandlerImport === undefined) fail(`${INDEX}: no handler imports found, so the generator cannot edit this file.`)
  index = out.edit(INDEX, index, lastHandlerImport[0], `${lastHandlerImport[0]}import { ${name}Handlers } from './handlers/${name}'\n`)
  index = out.edit(INDEX, index, '\n\n  const handlers: Handlers = {\n', `\n  const ${name}Ipc = ${name}Handlers()\n\n  const handlers: Handlers = {\n`)
  index = out.edit(INDEX, index, '\n  }\n  const listeners: Listeners = {', `\n    ...${name}Ipc,\n  }\n  const listeners: Listeners = {`)

  const fakeAnchor = '\n  }\n\n  // Every method goes through here'
  const fakeAt = fake.indexOf(fakeAnchor)
  if (fakeAt === -1 || fake[fakeAt - 1] !== ',') fail(`${FAKE}: the end of the fake's method list was not found, so the generator cannot edit this file.`)
  fake = out.edit(FAKE, fake, fakeAnchor,
    `\n    // Mirror what main does after this call (an event it emits, the state it changes), then delete this line's stub.\n    ${name}: () => Promise.reject(new Error('${name}: the fake is not written (tests/component/fakeApiary.ts)')),\n  }\n\n  // Every method goes through here`)

  const lastClauseImport = [...bridge.matchAll(/^import \{ define\w+Clauses \} from '\.\/clauses\/[^']+'\n/gm)].pop()
  if (lastClauseImport === undefined) fail(`${BRIDGE}: no clause imports found, so the generator cannot edit this file.`)
  bridge = out.edit(BRIDGE, bridge, lastClauseImport[0], `${lastClauseImport[0]}import { define${Name}Clauses } from './clauses/${name}'\n`)
  bridge = out.edit(BRIDGE, bridge, '\n  })\n}\n', `\n    define${Name}Clauses(ctx)\n  })\n}\n`)

  out.create(clauseFile, `import { describe, it } from 'vitest'
import type { Ctx } from '../support'

/** Move this into the clause file of the area that owns the call, if there is one. */
export function define${Name}Clauses(_ctx: Ctx): void {
  describe('${name}', () => {
    // Red until written: one clause that runs against the fake and the real main handlers.
    it('behaves the same in the fake and in main', () => {
      throw new Error('${name}: the contract clause is not written (${clauseFile})')
    })
  })
}
`)
  out.create(handlerFile, `import type { Handlers } from '../registrar'

type HandledKeys = '${name}'

/**
 * Move this into the \`handlers/<domain>.ts\` that owns the call if there is one. A handler validates
 * (the contract's guard has already run), delegates to a service and broadcasts if the mutation
 * leaves the UI stale; it holds no logic of its own.
 */
export function ${name}Handlers(): Pick<Handlers, HandledKeys> {
  return {
    ${name}: () => { throw new Error('${name}: the handler is not written (${handlerFile})') },
  }
}
`)
  out.write(CONTRACT, contract)
  out.write(INDEX, index)
  out.write(FAKE, fake)
  out.write(BRIDGE, bridge)

  return `Red until finished, on purpose (typecheck passes; the contract suite fails):
  1. ${CONTRACT}: set the argument guards and the result type of \`${name}\` (it is an invoke; use \`send\` for
     fire-and-forget and \`event\` for a push from main). A guard must prove the declared types; if it cannot, use
     \`invokeLoose\`, a comment naming the real validator and an entry in tests/unit/architecture/looseGuards.allow.json.
  2. ${handlerFile}: write the handler, or move it into the handlers file of its domain. It validates and delegates.
  3. ${FAKE}: replace the stub, mirroring any event main emits after the call (the fake's areas are in tests/component/fake/).
  4. ${clauseFile}: replace the failing clause with the real one, or move it into the clause file of its area.
  5. The renderer reaches it through a command in src/renderer/state/ (bridge-via-state), never window.apiary.
Then: npm run typecheck && npm run lint && npm test && npm run test:component`
}

// ── store ────────────────────────────────────────────────────────────────────────────────────────
function genStore(out, name, flags) {
  const Name = pascal(name)
  const fetchCall = flags.fetch
  if (fetchCall === undefined) fail('store needs --fetch <apiMethod>: the window.apiary call that reads the value (see src/shared/ipc/contract.ts).')
  const contract = out.read('src/shared/ipc/contract.ts')
  const keys = new Map([...contract.matchAll(IPC_KEYS)].map((m) => [m[1], m[2]]))
  const kindOf = keys.get(fetchCall)
  if (kindOf !== 'invoke' && kindOf !== 'invokeLoose') fail(`--fetch ${fetchCall}: not an invoke channel in the IPC contract.`)
  let subscribe = '() => () => {}'
  let pushNote = 'Nothing pushes this value: call `refresh()` after the command that changes it.'
  if (flags.event !== undefined) {
    const key = flags.event.replace(/^on/, '')
    const eventKey = key[0].toLowerCase() + key.slice(1)
    if (keys.get(eventKey) !== 'event') fail(`--event ${flags.event}: no event channel "${eventKey}" in the IPC contract.`)
    subscribe = `(_push, invalidate) => window.apiary.${flags.event}(invalidate)`
    pushNote = 'Main pushes a signal when it changes; the store then re-reads it.'
  }
  const file = `src/renderer/state/${name}Store.ts`
  out.create(file, `import type { ApiaryApi } from '@shared/api'
import { createIpcStore } from './createIpcStore'

/** What \`${fetchCall}\` answers. */
export type ${Name} = Awaited<ReturnType<ApiaryApi['${fetchCall}']>>

/**
 * ${Name}, read from main. ${pushNote} One subscription and one in-flight fetch however many
 * components read it (see createIpcStore.ts). \`null\` until the first answer.
 */
export const ${name}Store = createIpcStore<${Name} | null>({
  scope: 'app',
  initial: null,
  fetch: () => window.apiary.${fetchCall}(),
  subscribe: ${subscribe},
})

export function use${Name}(): ${Name} | null {
  return ${name}Store.useStore()
}
`)
  out.create(`tests/unit/${name}Store.test.ts`, `import { describe, expect, it } from 'vitest'
import { ${name}Store } from '../../src/renderer/state/${name}Store'

// The generic ordering (a push beats an older fetch, one fetch for many readers) is covered by
// createIpcStore.test.ts. Test what is specific to this store, then delete the failing case.
describe('${name}Store', () => {
  it('starts empty and holds what main answered', () => {
    void ${name}Store
    expect.fail('${name}Store: the test is not written (tests/unit/${name}Store.test.ts)')
  })
})
`)
  return `Next:
  1. ${file}: pick the right LogScope (src/shared/domain/log.ts), \`initial\`, and \`equal\` if the value is an object that is re-sent unchanged.
  2. A component reads it with use${Name}(); commands that change it go in this file (one error policy: src/renderer/state/policy.ts).
  3. tests/unit/${name}Store.test.ts: replace the failing case.
Until a component calls use${Name}(), lint:dead reports it as unused: wire it before you commit.`
}

// ── feature ──────────────────────────────────────────────────────────────────────────────────────
function genFeature(out, name) {
  const Name = pascal(name)
  const dir = `src/renderer/features/${name}`
  out.assertFree(dir)
  out.create(`${dir}/index.ts`, `/**
 * What the rest of the renderer may import from the ${name} feature. Other features and the app shell
 * import only from here (dependency-cruiser: renderer-feature-public-face).
 */
export { ${Name}Root } from './${Name}Root'
`)
  out.create(`${dir}/${Name}Root.tsx`, `import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { ${Name}View } from './${Name}View'

/** The feature's mount point. It wraps itself, so a crash inside shows in place and the window stays up. */
export function ${Name}Root(): React.JSX.Element {
  return (
    <ErrorBoundary label="${Name}">
      <${Name}View />
    </ErrorBoundary>
  )
}
`)
  out.create(`${dir}/${Name}View.tsx`, `export function ${Name}View(): React.JSX.Element {
  return <div className="${kebab(name)}" data-testid="${kebab(name)}" />
}
`)
  out.create(`${dir}/CLAUDE.md`, `# src/renderer/features/${name}

Read with root CLAUDE.md. Describe here, in a few lines each:

- What lives in this folder.
- The one sanctioned way for its common changes.
- Its tests.
- The pitfalls a comment in the code would otherwise have to carry.

Read what main owns through a store in \`src/renderer/state/\`, never through \`window.apiary\`.
`)
  out.create(`tests/component/${name}Feature.test.tsx`, `import { describe, expect, it } from 'vitest'
import { ${Name}Root } from '../../src/renderer/features/${name}'

describe('${name} feature', () => {
  it('shows what it is for', () => {
    void ${Name}Root
    expect.fail('${name}: the component test is not written (tests/component/${name}Feature.test.tsx)')
  })
})
`)
  return `Next:
  1. Mount ${Name}Root where it belongs (src/renderer/app/App.tsx). It wraps itself in an ErrorBoundary, which
     tests/unit/architecture/errorBoundaries.test.ts requires of anything mounted there.
  2. Fill in ${dir}/CLAUDE.md and the component test (it fails until written).
  3. Add a row to the feature map in root CLAUDE.md.
The folder compiles and lints as generated; only the failing test and your edits make it complete.`
}

// ── service ──────────────────────────────────────────────────────────────────────────────────────
function genService(out, name) {
  const Name = pascal(name)
  const file = `src/main/${name}/${name}Service.ts`
  out.assertFree(`src/main/${name}`)
  out.create(file, `import type { LogScope } from '@shared/domain/log'

/** Everything the service needs from outside, injected by the container so a test can replace it. */
export interface ${Name}ServiceDeps {
  /** Where the diagnostic log line goes. Add a scope to LogScope (src/shared/domain/log.ts) if none fits. */
  scope: LogScope
  /** Add collaborators here (other services, \`createExec\`, a JsonStore, the config root). Never import settings, env or app. */
}

/**
 * ${Name}. Owns its data and its behaviour; IPC handlers and AppService only delegate to it.
 * Built once, in \`createContainer\` (src/main/app/container.ts), and nowhere else.
 */
export class ${Name}Service {
  private readonly deps: ${Name}ServiceDeps

  constructor(deps: ${Name}ServiceDeps) {
    this.deps = deps
  }

  /** The scope this service logs under. Replace with the first real method. */
  scope(): LogScope {
    return this.deps.scope
  }
}
`)
  out.create(`tests/unit/${name}Service.test.ts`, `import { describe, expect, it } from 'vitest'
import { ${Name}Service } from '../../src/main/${name}/${name}Service'

describe('${name}Service', () => {
  it('does what it is for', () => {
    void ${Name}Service
    expect.fail('${name}Service: the test is not written (tests/unit/${name}Service.test.ts)')
  })
})
`)
  return `Next:
  1. src/main/app/container.ts: import ${Name}Service and add \`const ${name} = new ${Name}Service({ scope: 'app' })\`,
     return it from createContainer, and pass it to the handlers that need it. Add \`${Name}Service\` to the
     construct-in-container list in eslint/sanctioned.js so no other file builds one.
  2. Handlers take the service directly (src/main/ipc/handlers/); AppService is only a facade for the older services.
  3. Tests build it through tests/fixtures/buildService.ts or directly with fake deps. Replace the failing test.
  4. Add a row to the feature map in root CLAUDE.md, and a CLAUDE.md in src/main/${name}/ once it has pitfalls.
The file compiles and lints as generated; nothing runs it until the container builds it.`
}

/** Runs one generator. Returns the files touched and the follow-up text. */
export function generate({ kind, name, flags = {}, root }) {
  const out = new Out(root)
  const next = kind === 'ipc' ? genIpc(out, name)
    : kind === 'store' ? genStore(out, name, flags)
      : kind === 'feature' ? genFeature(out, name)
        : genService(out, name)
  return { created: out.created, edited: out.edited, next }
}

function main() {
  try {
    const { kind, name, flags } = parseArgs(process.argv.slice(2).filter((a, i, all) => a !== '--root' && all[i - 1] !== '--root'))
    const rootFlag = process.argv.indexOf('--root')
    const root = resolve(rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1] ?? '.')
    const { created, edited, next } = generate({ kind, name, flags, root })
    for (const f of created) console.log(`created  ${relative(root, join(root, f))}`)
    for (const f of edited) console.log(`edited   ${f}`)
    console.log(`\n${next}`)
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`new: ${e.message}`)
      process.exit(1)
    }
    throw e
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
