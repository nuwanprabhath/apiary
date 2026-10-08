/**
 * Reads a test-only environment variable, but never in a packaged build.
 *
 * `APIARY_*` hooks (and `ELECTRON_RENDERER_URL`) exist so the E2E suite can point the app at
 * fixture data, a fake updater, or a stand-in binary. A packaged app has no such need, and
 * anything that can set a launched process's environment (`launchctl setenv`, a `.desktop` file,
 * a wrapper script) could otherwise use one to redirect the config root, disable the real
 * updater, or — `ELECTRON_RENDERER_URL` — load an arbitrary remote page with the full preload
 * bridge (SEC-3). `--safe-theme` / `APIARY_SAFE_THEME` are deliberately not read through this: they
 * are a user recovery path, not a test hook.
 *
 * Pulled out as a pure function (rather than reading `app.isPackaged` and `process.env` inline)
 * so the packaged/unpackaged behaviour is unit-testable without importing `electron`.
 */
export function readTestEnv(name: string, env: NodeJS.ProcessEnv, isPackaged: boolean): string | undefined {
  return isPackaged ? undefined : env[name]
}

/**
 * Every test-only override and launch flag `main/index.ts` used to read at scattered points
 * (MAIN-15) — `APIARY_CONFIG_ROOT`/`APIARY_DB_PATH`/`APIARY_FAKE_LIVE` at startup,
 * `APIARY_CODE_PATH`, `APIARY_GLAB_PATH`, `APIARY_DEFAULT_THEME`, `APIARY_FAKE_UPDATE(_MODE)`,
 * `APIARY_HEADLESS`, and `ELECTRON_RENDERER_URL`. Computed once, in one place, so the app's own
 * test surface is discoverable by reading a type rather than by grepping.
 */
export interface RuntimeEnv {
  /** Overrides `resolveConfigRoot()` — a fixture's `~/.claude` in E2E. */
  configRoot: string | undefined
  /** Overrides the default `userData/apiary.db` path. */
  dbPath: string | undefined
  /** A session id to report as "live" without a real Claude process — see `detectLive`. */
  fakeLive: string | undefined
  /** Substitutes a fake `code` binary; an empty string simulates VS Code not being found. */
  codePathOverride: string | undefined
  /** Points the GitLab plugin's `glab` calls at a stand-in binary. */
  glabPath: string | undefined
  /** `true` to start a fresh profile on the original theme rather than the real default. */
  defaultThemeOriginal: boolean
  /** `--safe-theme` / `APIARY_SAFE_THEME=1` — a user recovery path, always honoured (not gated by
   *  `isPackaged`, unlike everything else here). */
  safeTheme: boolean
  /** Pretends a release exists, for driving the update banner end-to-end with no network. */
  fakeUpdate: string | undefined
  /** Which platform/packaging shape `fakeUpdate` should pretend to be. */
  fakeUpdateMode: string | undefined
  /** Keeps every window off-screen, for a test run that must not steal focus. */
  headless: boolean
  /** The Vite dev server origin, when running unbuilt. */
  rendererUrl: string | undefined
  /** Answers the folder picker with this path instead of opening the native dialog — E2E only:
   *  a native dialog cannot be driven by Playwright, and would land on the user's screen. */
  pickFolder: string | undefined
  /** Answers the pet export dialog with this path (test only). */
  petExportPath: string | undefined
  /** Answers the pet import dialog with this path (test only). */
  petImportPath: string | undefined
  /** Forces a window chrome (`custom`, `mac`, `system`) — E2E only, so the Windows/Linux title bar
   *  and its menu can be driven on any machine. */
  windowChrome: string | undefined
  /** JSON for the renderer's test seams (`renderer/state/testSeams.ts`), passed to every window in
   *  its URL — component-style speed-ups an e2e spec may want (pets' scenes in seconds). */
  rendererSeams: string | undefined
}

/** Parses every runtime override in one place. `argv`/`env`/`isPackaged` are passed in rather
 *  than read from `process`/`app` directly, so this is a pure function a unit test can call
 *  without importing `electron`. */
export function parseRuntimeEnv(env: NodeJS.ProcessEnv, argv: string[], isPackaged: boolean): RuntimeEnv {
  const test = (name: string): string | undefined => readTestEnv(name, env, isPackaged)
  return {
    configRoot: test('APIARY_CONFIG_ROOT'),
    dbPath: test('APIARY_DB_PATH'),
    fakeLive: test('APIARY_FAKE_LIVE'),
    codePathOverride: test('APIARY_CODE_PATH'),
    glabPath: test('APIARY_GLAB_PATH'),
    defaultThemeOriginal: test('APIARY_DEFAULT_THEME') === 'original',
    safeTheme: argv.includes('--safe-theme') || env.APIARY_SAFE_THEME === '1',
    fakeUpdate: test('APIARY_FAKE_UPDATE'),
    fakeUpdateMode: test('APIARY_FAKE_UPDATE_MODE'),
    headless: test('APIARY_HEADLESS') === '1',
    rendererUrl: test('ELECTRON_RENDERER_URL'),
    pickFolder: test('APIARY_PICK_FOLDER'),
    petExportPath: test('APIARY_PET_EXPORT_PATH'),
    petImportPath: test('APIARY_PET_IMPORT_PATH'),
    windowChrome: test('APIARY_WINDOW_CHROME'),
    rendererSeams: test('APIARY_RENDERER_SEAMS'),
  }
}
