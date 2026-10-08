// @ts-check

/**
 * One sanctioned way to do each of these things. Read by `plugin.js`, which turns every entry into
 * an `apiary/<name>` rule.
 *
 * - `files`: where the rule applies (globs from the repo root).
 * - `allow`: the sanctioned homes — the only files that may do the thing directly. Changing this
 *   list is a design decision, visible in review; it is not how to make an error go away.
 * - Code that broke a rule before the rule existed is baselined in `eslint-suppressions.json`,
 *   which may only shrink: fixing a site makes `eslint` fail until `npm run lint:prune` removes its
 *   entry. A new violation fails at once.
 * - `message` is what the agent reads when the rule fires: say what to use instead and where it
 *   lives, then why, in that order.
 *
 * To add a rule: one entry here, then `npm run lint:baseline` once to record today's violations,
 * and prove it fires on a real past mistake (see `.claude/skills/correct/SKILL.md`).
 *
 * @typedef {{ name: string, description: string, message: string, files: readonly string[], allow?: readonly string[] }} Base
 * @typedef {Base & { kind: 'syntax', selectors: readonly string[] }} SyntaxRule
 * @typedef {Base & { kind: 'import', sources: readonly (string | RegExp)[], importNames?: readonly string[] }} ImportRule
 * @typedef {Base & { kind: 'global', globals: readonly string[] }} GlobalRule
 * @typedef {SyntaxRule | ImportRule | GlobalRule} Sanctioned
 */

const SRC = ['src/**/*.{ts,tsx}']
const MAIN = ['src/main/**/*.ts']
const RENDERER = ['src/renderer/**/*.{ts,tsx}']
const TESTS = ['tests/**/*.{ts,tsx}']

/** `window.apiary.<call>` — the preload bridge. */
const BRIDGE = "MemberExpression[object.object.name='window'][object.property.name='apiary']"

/** @type {readonly Sanctioned[]} */
export const SANCTIONED = [
  // ── Main process ──────────────────────────────────────────────────────────────────────────────
  {
    name: 'no-raw-subprocess',
    kind: 'import',
    files: MAIN,
    sources: ['node:child_process', 'child_process'],
    allow: ['src/main/exec/**'],
    description: 'Subprocesses start only in src/main/exec.',
    message:
      'Start processes through src/main/exec: `createExec` (exec/run.ts) for a short-lived command, `spawnLoginShell` for a long-lived claude/shell. ' +
      'They own the timeout, the `error` listener, process-group kill and `--` before positional text, which every hand-rolled spawn here has missed at least once.',
  },
  {
    name: 'no-raw-state-write',
    kind: 'import',
    files: MAIN,
    sources: ['node:fs', 'fs', 'node:fs/promises', 'fs/promises'],
    importNames: ['writeFileSync', 'writeFile', 'renameSync', 'rename', 'appendFileSync', 'appendFile'],
    allow: [
      'src/main/fs/**',
      // Not persisted state: the diagnostic log appends, pasted images are content-addressed
      // blobs, the prompt shims are regenerated at every launch.
      'src/main/log/logger.ts',
      'src/main/media/imageStore.ts',
      'src/main/pty/promptPath.ts',
    ],
    description: 'Persisted state is written only through src/main/fs.',
    message:
      'Write persisted state through src/main/fs (`writeJsonAtomic`, or a versioned JsonStore). ' +
      'A plain write truncates the file on a crash and the next launch silently falls back to defaults — the user loses settings, layouts or pets.',
  },
  {
    name: 'confine-via-real-path',
    kind: 'syntax',
    files: MAIN,
    selectors: [
      "CallExpression[callee.property.name='startsWith'][arguments.0.type='BinaryExpression'][arguments.0.operator='+'][arguments.0.right.name='sep']",
      "CallExpression[callee.property.name='startsWith'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.1.name='sep']",
      "CallExpression[callee.name='relative']",
    ],
    allow: ['src/main/fs/confine.ts'],
    description: 'Confining a path to a directory goes through realPathInside.',
    message:
      'Use `realPathInside(root, path)` (src/main/fs/confine.ts) and read the real path it returns. ' +
      'A `resolve` plus `startsWith(root + sep)` check is lexical: a symlink inside the root that points outside it passes (imageStore.read did).',
  },
  {
    name: 'no-short-refnames',
    kind: 'syntax',
    files: MAIN,
    selectors: [
      'Literal[value=/(?:refname|upstream|push|symref):short/]',
      'TemplateElement[value.raw=/(?:refname|upstream|push|symref):short/]',
      "Literal[value='--abbrev-ref']",
      "ArrayExpression:has(> Literal[value='symbolic-ref']) > Literal[value='--short']",
    ],
    allow: ['src/main/git/refs.ts'],
    description: 'Ref names come from git as full refnames, not its short form.',
    message:
      'Ask git for the full refname and strip the namespace: `listRefsArgs` / `parseRefRows` / `branchFromRef` in src/main/git/refs.ts. ' +
      'The short form (`%(refname:short)`, `--abbrev-ref`, `symbolic-ref --short`) is git\'s presentation and varies by version and by what else exists: git 2.48 prints `origin/HEAD` as a bare `origin` (the branch list offered a remote called origin), and an ambiguous ref prints as `heads/x`.',
  },
  {
    name: 'ipc-through-registrar',
    kind: 'import',
    files: MAIN,
    sources: ['electron'],
    importNames: ['ipcMain'],
    allow: ['src/main/ipc/registrar.ts', 'src/main/ipc/handlers/theme.ts'],
    description: 'Only the registrar touches ipcMain.',
    message:
      'Declare the channel in src/shared/ipc/contract.ts and add its handler in src/main/ipc/handlers/<domain>.ts. ' +
      'The registrar validates arguments, checks the sender and logs failures; a raw ipcMain listener skips all three.',
  },
  {
    name: 'send-through-windows',
    kind: 'syntax',
    files: MAIN,
    selectors: ["CallExpression[callee.property.name='send'][callee.object.property.name='webContents']", "CallExpression[callee.property.name='send'][callee.object.property.name='sender']"],
    allow: ['src/main/windows/**'],
    description: 'Main→renderer events go through src/main/windows.',
    message:
      'Send events with `broadcast` (src/main/windows/broadcast.ts), or the per-window helpers in src/main/windows. ' +
      'A hand-rolled send has gone only to the focused window before (MAIN-12), and skips the destroyed-window check.',
  },
  {
    name: 'no-unchecked-senders-in-app',
    kind: 'import',
    files: SRC,
    sources: [/ipcSenderGuard$/],
    importNames: ['UNCHECKED_SENDERS'],
    description: 'Only a test harness opts out of the IPC sender check.',
    message:
      'Pass the real `TrustedRendererConfig` as `senderPolicy` (see main/index.ts). `UNCHECKED_SENDERS` is for tests that call handlers without a frame. ' +
      'The check fails closed: a message whose sender frame is gone is rejected (Electron sets it to null for a destroyed frame), and this opt-out is the only way around that.',
  },
  {
    name: 'construct-in-container',
    kind: 'syntax',
    files: MAIN,
    selectors: ["NewExpression[callee.name=/^(PtyManager|SessionStore|SearchIndex|SearchService|ChatManager|PetService|PetStore|ThemeStore|ClaudeOneShot|SessionWatcher|ClaudeProjectsSource|SettingsService|GitService|TerminalService|ImageStore|ChatService|PluginService|WorktreeResolver|BranchOps|MrStatusCache|TranscriptReader|SearchClient)$/]"],
    // The search worker is its own thread with its own composition root: it opens its own SearchIndex.
    allow: ['src/main/app/container.ts', 'src/main/search/searchWorker.ts'],
    description: 'Long-lived objects are built only in the composition root.',
    message:
      'Build long-lived objects in `createContainer` (src/main/app/container.ts) and inject them. ' +
      'An object built inside a service cannot be replaced in a test and gets built twice when a second caller copies the pattern (ClaudeProjectsSource was).',
  },
  {
    name: 'credentials-behind-consent',
    kind: 'syntax',
    files: SRC,
    selectors: [
      'Literal[value=/Claude Code-credentials|\\.credentials\\.json|api\\.anthropic\\.com|find-generic-password/]',
      'TemplateElement[value.raw=/Claude Code-credentials|\\.credentials\\.json|api\\.anthropic\\.com|find-generic-password/]',
    ],
    // The two functions that take a `Consent`: the token read, and the one request that sends it.
    allow: ['src/main/statusBar/claudeUsage/credentials.ts', 'src/main/statusBar/claudeUsage/limits.ts'],
    description: 'Claude Code\'s sign-in is read, and sent to Anthropic, only behind the user\'s consent.',
    message:
      'The Claude Code token (Keychain item, `.credentials.json`) and the api.anthropic.com usage endpoint are touched only in ' +
      'src/main/statusBar/claudeUsage/credentials.ts and limits.ts, whose functions require a `Consent` from the ConsentStore (consent.ts). ' +
      'Call `readAccessToken(consent, ...)` / `fetchLimits(consent, ...)` through the usage plugin instead of reading or sending a credential here (ADR-0019).',
  },
  {
    name: 'consent-minted-by-store',
    kind: 'syntax',
    files: SRC,
    selectors: ["TSAsExpression[typeAnnotation.typeName.name='Consent']", "TSTypeAssertion[typeAnnotation.typeName.name='Consent']"],
    allow: ['src/main/statusBar/claudeUsage/consent.ts'],
    description: 'A Consent comes from ConsentStore.proof() and nowhere else.',
    message:
      'Do not cast to `Consent`. Take it from `ConsentStore.proof()` (src/main/statusBar/claudeUsage/consent.ts), which answers only once the user has agreed; ' +
      'a cast makes the credential functions compile without anyone having asked (ADR-0019).',
  },

  // ── Renderer ──────────────────────────────────────────────────────────────────────────────────
  {
    name: 'bridge-via-state',
    kind: 'syntax',
    files: RENDERER,
    selectors: [BRIDGE],
    allow: ['src/renderer/state/**'],
    description: 'Components reach main only through src/renderer/state.',
    message:
      'Read and act through a store or hook in src/renderer/state (see state/CLAUDE.md); add one there if none fits. ' +
      'A component calling window.apiary itself re-implements fetch + subscribe + stale-response ordering, and has got it wrong (usePets, useUpdate).',
  },
  {
    name: 'stores-via-factory',
    kind: 'import',
    files: RENDERER,
    sources: ['react'],
    importNames: ['useSyncExternalStore'],
    allow: [
      'src/renderer/state/createIpcStore.ts',
      'src/renderer/state/createLocalStore.ts',
      // Special stores with a documented shape of their own: the theme snapshot read before first
      // paint (bridgeBinding.ts), and the workspace reducer's selector store (A5).
      'src/renderer/state/themeStore.ts',
      'src/renderer/features/workspace/useWorkspaceSelector.ts',
    ],
    description: 'Shared renderer state is built by a store factory, not hand-rolled.',
    message:
      'Build the store with a factory in src/renderer/state: `createIpcStore` for data main owns, `createLocalStore` for in-memory per-window state (`state/uiState.ts` if it must be saved). ' +
      'A hand-rolled listener set + useSyncExternalStore re-implements change notification and test-bridge resets each time (state/CLAUDE.md, "Which store").',
  },
  {
    name: 'no-polling-in-features',
    kind: 'syntax',
    files: RENDERER,
    selectors: ["CallExpression[callee.name='setInterval']", "CallExpression[callee.property.name='setInterval']"],
    allow: ['src/renderer/state/**', 'src/renderer/**/*.worker.ts'],
    description: 'No per-component polling timers.',
    message:
      'Use a push event from main, or a store in src/renderer/state with one shared timer (mrStatusStore). ' +
      'A per-component interval runs once per mounted copy and keeps running after the thing it waited for has happened. An animation clock may disable this with a reason.',
  },
  {
    name: 'workspace-via-selector',
    kind: 'syntax',
    files: ['src/renderer/features/pane/**/*.{ts,tsx}'],
    selectors: ["CallExpression[callee.name='useWorkspace']"],
    allow: ['src/renderer/features/workspace/**'],
    description: 'A pane reads its own slice of the workspace, never all of it.',
    message:
      'Read the slice with `useWorkspaceSelector` (features/workspace/useWorkspaceSelector.ts; a pane\'s own tabs are `usePaneWorkspace`), and dispatch with `useWorkspaceDispatch`. ' +
      '`useWorkspace()` re-renders on every transition, so one pending session or tab activation in another pane rendered every SessionColumn and `memo` bought nothing.',
  },
  {
    name: 'no-raw-storage',
    kind: 'global',
    files: RENDERER,
    globals: ['localStorage', 'sessionStorage', 'indexedDB'],
    allow: ['src/renderer/state/uiState.ts', 'src/renderer/features/pets/render3d/usePetImages.ts'],
    description: 'Renderer persistence goes through state/uiState.ts.',
    message:
      'Persist UI state through src/renderer/state/uiState.ts (shared vs per-window keys, versioning, a read that survives a blocked storage). ' +
      'Every other storage key here is invisible to the reset and migration code.',
  },
  {
    name: 'paste-via-terminal-paste',
    kind: 'syntax',
    files: RENDERER,
    selectors: [
      "CallExpression[callee.property.name='paste']",
      "CallExpression[callee.property.name='addEventListener'][arguments.0.value='paste']",
    ],
    allow: ['src/renderer/features/terminal/terminalPaste.ts'],
    description: 'Text pasted into a terminal reaches the pty only through terminalPaste.',
    message:
      'Paste through `pasteText` (features/terminal/terminalPaste.ts); a native `paste` event is routed there by `routeNativePaste`. ' +
      'It strips ESC from the text first: xterm brackets a paste but keeps an `ESC[201~` inside it, which ends the bracket early and runs the rest as keystrokes (SEC-6).',
  },
  {
    name: 'icons-from-ui',
    kind: 'syntax',
    files: RENDERER,
    selectors: ["JSXOpeningElement[name.name='svg']"],
    allow: ['src/renderer/ui/icons.tsx', 'src/renderer/ui/icons/**', 'src/renderer/features/pets/**'],
    description: 'Icons live in src/renderer/ui/icons.',
    message: 'Add the icon to src/renderer/ui/icons.tsx (or ui/icons/) and import it, so size, stroke and aria-hidden stay consistent.',
  },
  {
    name: 'roles-via-primitives',
    kind: 'syntax',
    files: RENDERER,
    selectors: ["JSXAttribute[name.name='role'][value.value=/^(dialog|alertdialog|menu|menubar|listbox)$/]"],
    allow: ['src/renderer/ui/**'],
    description: 'Widget roles come from the ui/ primitive that implements their keyboard contract.',
    message:
      'Use the primitive in src/renderer/ui that implements this role (Modal for dialog, Menu for menu, Listbox for listbox). ' +
      'A role promises keyboard behaviour to assistive tech; a hand-written one has shipped without it (ModeMenu, ModelPicker).',
  },
  {
    name: 'role-button-is-operable',
    kind: 'syntax',
    files: RENDERER,
    selectors: [
      // A non-<button> that says it is a button, with no way to focus it or to press it.
      "JSXOpeningElement[name.name!='button']:has(> JSXAttribute[name.name='role'][value.value='button']):not(:has(> JSXAttribute[name.name='tabIndex']))",
      "JSXOpeningElement[name.name!='button']:has(> JSXAttribute[name.name='role'][value.value='button']):not(:has(> JSXAttribute[name.name='onKeyDown']))",
    ],
    allow: ['src/renderer/ui/**'],
    description: 'role="button" on a non-button needs tabIndex and a key handler.',
    message:
      'Use a real <button> (or the primitive in src/renderer/ui) if the content allows it; otherwise give the element `tabIndex={0}` and an `onKeyDown` for Enter and Space, as the pet in features/pets/PetLayer.tsx does. ' +
      'A role promises focus and keyboard activation to assistive tech; the pets were role="button" and unreachable without a mouse (UI-27).',
  },
  {
    name: 'drag-via-use-resize-drag',
    kind: 'syntax',
    files: RENDERER,
    selectors: [
      "CallExpression[callee.property.name='setPointerCapture']",
      "CallExpression[callee.property.name='addEventListener'][arguments.0.value=/^(mousemove|pointermove)$/]",
    ],
    allow: ['src/renderer/ui/**'],
    description: 'Drag-resizing goes through useResizeDrag.',
    message:
      'Use `useResizeDrag` for a drag handle: it commits once on release, sets the body cursor class and gives the separator its keyboard steps. ' +
      'Hand-rolled drags re-render or write storage on every mousemove (UI-6) and are pointer-only (UI-27).',
  },
  {
    name: 'outside-dismiss-via-ui',
    kind: 'syntax',
    files: RENDERER,
    selectors: ["CallExpression[callee.property.name='addEventListener'][arguments.0.value=/^(mousedown|pointerdown)$/]"],
    allow: ['src/renderer/ui/**'],
    description: 'Click-outside-to-close goes through a ui/ hook.',
    message: 'Use the shared outside-dismiss hook in src/renderer/ui (with useEscape) instead of a document pointerdown listener; six copies differ in capture phase and portal handling.',
  },
  {
    name: 'focus-unless-typing',
    kind: 'syntax',
    files: RENDERER,
    selectors: [
      "JSXAttribute[name.name='autoFocus']",
      "CallExpression[callee.name=/^use(Layout)?Effect$/][arguments.1.type='ArrayExpression'][arguments.1.elements.length=0]:has(CallExpression[callee.property.name='focus'])",
    ],
    allow: ['src/renderer/ui/**'],
    description: 'Focus taken on mount never comes from a text field the user is typing in.',
    message:
      'Move focus with `focusUnlessTyping(el)` (src/renderer/ui/focusUnlessTyping.ts): it leaves focus alone while a text field has it. ' +
      'A component that appears on its own (a permission prompt, a toast, an update) took focus with `autoFocus` or a mount effect, and the Enter meant to send a message approved a tool. ' +
      'Dialogs and menus get focus from Modal and Menu. A field the user just asked for (inline rename, "No…") may disable this line with `-- <why>`.',
  },
  {
    name: 'branded-ids-from-source',
    kind: 'import',
    files: RENDERER,
    sources: [/(^@shared|\/shared)\/domain\/ids$/],
    importNames: ['asSessionId', 'asPtyId'],
    allow: ['src/renderer/state/**', 'src/renderer/features/workspace/**'],
    description: 'Branded ids are minted where data enters the renderer.',
    message:
      'Carry a SessionId/PtyId from where it was minted (state/ or features/workspace) instead of casting at the call site. ' +
      'If the field you are reading is a plain string, brand that field in its shared type.',
  },
  {
    name: 'no-void-bridge-call',
    kind: 'syntax',
    files: RENDERER,
    selectors: [`UnaryExpression[operator='void'] ${BRIDGE}`],
    allow: ['src/renderer/ui/fireAndForget.ts'],
    description: 'A fire-and-forget bridge call is logged, not dropped.',
    message: 'Wrap it: `fireAndForget(window.apiary.x(...), \'scope\')` (ui/fireAndForget.ts), or handle the error with notifyError. `void` turns a failed IPC call into nothing at all.',
  },

  {
    name: 'no-global-seams',
    kind: 'syntax',
    files: SRC,
    selectors: [
      // `globalThis.__x`, `window.__x`, `(globalThis as Record<string, unknown>).__x`
      "MemberExpression[property.name=/^__/][object.name=/^(globalThis|window|self)$/]",
      "MemberExpression[property.name=/^__/][object.type='TSAsExpression'][object.expression.name=/^(globalThis|window|self)$/]",
      // `g['__apiaryX']`, or a `const FLAG = '__apiaryX'` used as the key
      "Literal[value=/^__apiary/]",
    ],
    allow: ['src/renderer/state/testSeams.ts'],
    description: 'A test seam is a field of state/testSeams.ts, never a global.',
    message:
      'Add the option to `TestSeams` in src/renderer/state/testSeams.ts and read it with `testSeams()`; a test sets it with `setTestSeams`, an e2e run through `APIARY_RENDERER_SEAMS`. ' +
      'A `globalThis.__apiary*` property ships in the production bundle and any script in the page can switch it (the pets\' brain options and flat flag did). main/app/env.ts keeps the seam inert when packaged.',
  },

  // ── All source ────────────────────────────────────────────────────────────────────────────────
  {
    name: 'no-silent-catch',
    kind: 'syntax',
    files: SRC,
    selectors: [
      "CallExpression[callee.property.name='catch'][arguments.0.type='ArrowFunctionExpression'][arguments.0.body.type='BlockStatement'][arguments.0.body.body.length=0]",
      "CallExpression[callee.property.name='catch'][arguments.0.type='ArrowFunctionExpression'][arguments.0.body.type=/^(Literal|Identifier)$/]",
      'CatchClause[body.body.length=0]',
    ],
    description: 'Errors are logged or shown, never swallowed silently.',
    message:
      'Use `fireAndForget(promise, scope)` (src/main/log or src/renderer/ui) to log it, or notifyError to show it. ' +
      'If failure really is expected and harmless (a process that already exited, a file that may be gone), ' +
      'wrap the call in `ignoreErrors(fn, why)` / `ignoreErrorsAsync` from @shared/ignoreErrors so the next reader knows it is deliberate.',
  },
  {
    name: 'error-message-helper',
    kind: 'syntax',
    files: SRC,
    selectors: ["ConditionalExpression[test.operator='instanceof'][test.right.name='Error']"],
    allow: ['src/shared/errors.ts'],
    description: 'One way to turn an unknown error into text.',
    message: 'Use `errorMessage(e)` from @shared/errors.',
  },
  {
    name: 'tab-view-type',
    kind: 'syntax',
    files: SRC,
    selectors: ["TSUnionType:has(> TSLiteralType[literal.value='transcript']):has(> TSLiteralType[literal.value='terminal'])"],
    allow: ['src/shared/domain/tabs.ts'],
    description: 'One definition of what a tab shows: `TabView`.',
    message:
      "Use `TabView` from @shared/domain/tabs instead of writing `'transcript' | 'terminal'` again (SHARED-3). " +
      'A copy of the union keeps compiling when a third view is added, and the places that missed it fail at runtime.',
  },
  {
    name: 'no-cast-through-unknown',
    kind: 'syntax',
    files: SRC,
    selectors: ["TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']"],
    description: 'No `x as unknown as T`.',
    message:
      'Narrow with a type guard instead (shared guards in @shared/guards, IPC argument guards in src/shared/ipc). ' +
      'A double cast is how an unvalidated renderer value reached a handler typed as validated (petUpdate).',
  },

  // ── Tests ─────────────────────────────────────────────────────────────────────────────────────
  {
    name: 'no-test-sleep',
    kind: 'syntax',
    files: TESTS,
    selectors: [
      "NewExpression[callee.name='Promise'] CallExpression[callee.name='setTimeout']",
      "NewExpression[callee.name='Promise'] CallExpression[callee.property.name='setTimeout']",
      "ImportDeclaration[source.value=/^(node:)?timers\\/promises$/] ImportSpecifier[imported.name='setTimeout']",
    ],
    allow: ['tests/fixtures/stays.ts'],
    description: 'Tests wait for a condition, not for time.',
    message:
      'Wait for the condition: `vi.waitFor`/`expect.poll` (Vitest), `expect(...).toPass`/locator assertions (Playwright), `nextFrames`/`settled` (tests/component/helpers.ts) to let React commit or a layout settle, or a fake clock. ' +
      'To prove something does NOT happen, use `stays(check, ms, what)` (tests/fixtures/stays.ts; `expectStays` in e2e helpers). A sleep is slow when the machine is idle and flaky when it is loaded.',
  },
  {
    name: 'shared-alias-in-tests',
    kind: 'import',
    files: TESTS,
    sources: [/^(\.\.\/)+src\/shared\//],
    description: 'Tests import shared code through @shared.',
    message: 'Import it as `@shared/...` (STRUCT-4), so a test reads like the code it tests and survives a test moving folders.',
  },
]
