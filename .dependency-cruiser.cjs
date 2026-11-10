// Dependency direction for src/ (`npm run lint:arch`). It replaces `madge --circular`: the same
// cycle check, plus the layer rules below, plus a committed baseline of what already breaks them
// (`.dependency-cruiser-known-violations.json`) so a rule fails only on new edges. Fixing an old
// edge and re-running `npm run lint:arch:baseline` shrinks the baseline; growing it needs a reason
// in review. Every rule's `comment` is what an agent sees when it fires: say where the code goes.

/** Main-process folders by layer. An arrow only points down: app → ipc → services → infra. */
const MAIN_INFRA = '^src/main/(exec|fs|log|util|pty|store|scanner|tree|transcript|search|windows)/'
const MAIN_SERVICES = '^src/main/(claude|git|plugins|chat|pets|theme|terminals|sessions|statusBar|update|vscode|media|sources|settings)/|^src/main/(settings|appService)\\.ts$'
const MAIN_IPC = '^src/main/ipc/'
const MAIN_APP = '^src/main/app/|^src/main/index\\.ts$'

/**
 * Which folder of src/main may import which. A folder not listed under another's entry may not be
 * imported by it. Files directly in src/main (index.ts, settings.ts, appService.ts) are not folders
 * and are outside the table. To allow a new edge, add it here and say why in review.
 */
const MAIN_EDGES = {
  accounts: ['exec', 'fs', 'log'],
  app: ['accounts', 'chat', 'claude', 'exec', 'folders', 'git', 'ipc', 'knowledge', 'library', 'log', 'media', 'pets', 'plugins', 'pty', 'remote', 'residents', 'search', 'sessions', 'settings', 'sources', 'spelling', 'statusBar', 'store', 'terminals', 'theme', 'transcript', 'update', 'vscode', 'windows'],
  chat: ['accounts', 'claude', 'exec', 'log', 'pty', 'sessions', 'store', 'terminals', 'transcript', 'windows'],
  claude: ['accounts', 'exec', 'log', 'pty'],
  exec: ['log'],
  folders: ['fs'],
  fs: [],
  git: ['exec', 'log', 'plugins', 'sessions'],
  ipc: ['accounts', 'chat', 'claude', 'folders', 'library', 'log', 'pets', 'plugins', 'remote', 'residents', 'settings', 'spelling', 'terminals', 'theme', 'update', 'windows'],
  knowledge: ['accounts', 'claude', 'fs', 'log', 'search', 'store', 'transcript', 'util'],
  library: ['fs', 'log'],
  log: [],
  media: ['fs'],
  pets: ['claude', 'fs', 'log', 'windows'],
  plugins: ['exec', 'git', 'sessions', 'statusBar'],
  pty: ['exec', 'log'],
  remote: ['exec', 'fs', 'ipc', 'log', 'vscode', 'windows'],
  residents: ['chat', 'exec', 'fs', 'knowledge', 'log', 'search'],
  scanner: ['transcript'],
  search: ['log', 'store', 'transcript', 'util'],
  sessions: ['claude', 'fs', 'git', 'log', 'pty', 'scanner', 'search', 'sources', 'store', 'transcript', 'tree', 'util'],
  settings: ['fs'],
  sources: ['scanner'],
  spelling: [],
  statusBar: ['accounts', 'exec', 'log', 'plugins'],
  store: [],
  terminals: ['accounts', 'chat', 'git', 'log', 'pty', 'sessions', 'store', 'windows'],
  theme: ['claude', 'fs', 'log'],
  transcript: [],
  tree: ['store'],
  update: ['exec', 'fs', 'log', 'settings', 'windows'],
  util: [],
  vscode: ['exec', 'fs', 'sessions'],
  windows: ['fs', 'log', 'remote'],
}

/** Folders that import each other today, so the table has a cycle inside each group and nowhere else. */
const MAIN_PEER_GROUPS = [
  ['git', 'plugins', 'sessions', 'statusBar'],
  ['chat', 'ipc', 'pets', 'remote', 'residents', 'terminals', 'update', 'windows'],
]

/** Throws, naming the folders, when the table has a cycle that is not inside one peer group. */
function assertNoEdgeCycle(edges, groups) {
  const rep = (f) => (groups.find((g) => g.includes(f)) || [f])[0]
  const deps = {}
  for (const [from, tos] of Object.entries(edges)) {
    for (const to of tos) {
      if (rep(from) !== rep(to)) (deps[rep(from)] ??= new Set()).add(rep(to))
    }
  }
  const state = {}
  const visit = (n, trail) => {
    if (state[n] === 2) return
    if (state[n] === 1) throw new Error('main folder import cycle: ' + [...trail.slice(trail.indexOf(n)), n].join(' -> '))
    state[n] = 1
    for (const m of deps[n] || []) visit(m, [...trail, n])
    state[n] = 2
  }
  for (const n of Object.keys(deps)) visit(n, [])
}
assertNoEdgeCycle(MAIN_EDGES, MAIN_PEER_GROUPS)

const mainDomainEdges = Object.entries(MAIN_EDGES).map(([folder, allowed]) => ({
  name: 'main-domain-edges',
  severity: 'error',
  comment: `src/main/${folder}/ may import only: ${allowed.join(', ') || 'no other folder'}. Move the shared piece down (exec, util, fs), inject it, or change MAIN_EDGES at the top of this file with the reason.`,
  from: { path: `^src/main/${folder}/` },
  to: { path: '^src/main/[^/]+/', pathNot: [`^src/main/(${[folder, ...allowed].join('|')})/`] },
}))

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...mainDomainEdges,
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle makes load order matter and hides which module owns what. Move the shared piece down a layer (often to src/shared).',
      from: { path: '^src/' },
      to: { circular: true },
    },
    {
      name: 'main-infra-stays-down',
      severity: 'error',
      comment: 'Infrastructure (exec, fs, log, pty, store, windows, ...) must not know about services, IPC or the app. Pass what it needs in as a parameter or callback.',
      from: { path: MAIN_INFRA },
      to: { path: [MAIN_SERVICES, MAIN_IPC, MAIN_APP] },
    },
    {
      name: 'main-services-below-ipc',
      severity: 'error',
      comment: 'A service must not import the IPC layer or the composition root. Inject the dependency from src/main/app/container.ts instead.',
      from: { path: MAIN_SERVICES },
      to: { path: [MAIN_IPC, MAIN_APP] },
    },
    {
      name: 'main-ipc-below-app',
      severity: 'error',
      comment: 'IPC handlers receive their services from the container through IpcDeps; they do not reach into src/main/app.',
      from: { path: MAIN_IPC },
      to: { path: MAIN_APP },
    },
    {
      name: 'ipc-handlers-are-adapters',
      severity: 'error',
      comment: 'A handler validates and delegates. File reads/writes, dialogs and processes belong in a service (src/main/<domain>/), where they can be tested without IPC.',
      from: { path: '^src/main/ipc/handlers/' },
      to: { path: '^(node:)?(fs|fs/promises|child_process)$|^src/main/(store|pty|exec|fs)/' },
    },
    {
      name: 'renderer-ui-and-state-below-features',
      severity: 'error',
      comment: 'ui/ (primitives) and state/ (stores) are used by features, never the other way round. Move the shared piece into ui/ or state/.',
      from: { path: '^src/renderer/(ui|state)/' },
      to: { path: '^src/renderer/(features|app)/' },
    },
    {
      name: 'renderer-features-below-app',
      severity: 'error',
      comment: 'Features do not import the app shell (src/renderer/app). Lift the shared piece into a feature, state/ or ui/.',
      from: { path: '^src/renderer/features/' },
      to: { path: '^src/renderer/app/' },
    },
    {
      name: 'renderer-feature-public-face',
      severity: 'error',
      comment: "Import another feature through its index.ts, not its internals; if what you need is not exported there, it is that feature's decision to export it.",
      from: { path: '^src/renderer/features/([^/]+)/' },
      to: {
        path: '^src/renderer/features/',
        pathNot: ['^src/renderer/features/$1/', '^src/renderer/features/[^/]+/index\\.tsx?$'],
      },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'Nothing imports this file. Delete it, or import it from where it is used.',
      from: {
        orphan: true,
        path: '^src/',
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)CLAUDE\\.md$',
          '^src/main/index\\.ts$',
          '^src/preload/index\\.ts$',
          '^src/renderer/main\\.tsx$',
          '\\.worker\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(out|dist|release|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'] },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
