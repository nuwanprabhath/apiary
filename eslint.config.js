// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import eslintReact from '@eslint-react/eslint-plugin'
import vitest from '@vitest/eslint-plugin'
import playwright from 'eslint-plugin-playwright'
import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * One config for the whole repo, split by where code runs:
 *
 * - main (Node, Electron's main process) and preload;
 * - renderer (the browser, behind context isolation — it reaches Node only through the preload API);
 * - shared (imported by both, so it may use neither side's globals);
 * - unit/integration tests (Vitest) and e2e tests (Playwright);
 * - build scripts (plain Node ESM).
 *
 * Type-aware throughout (typescript-eslint's project service reads tsconfig.json and
 * tsconfig.node.json), because the rules that catch real bugs here — floating promises in IPC
 * handlers, misused async callbacks in React props — need types.
 */
export default defineConfig([
  globalIgnores(['out/', 'dist/', 'release/', 'node_modules/', '.worktrees/', 'test-results/', 'playwright-report/', 'coverage/']),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Both projects, named explicitly: the project service only finds files a `tsconfig.json`
        // includes, and the main process and its tests live in tsconfig.node.json. The root tool
        // configs and the screenshot spec are in neither, so tsconfig.eslint.json adds them.
        project: ['./tsconfig.json', './tsconfig.node.json', './tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // The codebase's own conventions, which tsc does not enforce.
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // A promise nobody awaits is how an IPC failure disappears without a trace; `void` marks the
      // ones that are fire-and-forget on purpose.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // React event props take `() => void`; an async handler there is fine as long as it is
      // not expected to be awaited, which is exactly what `checksVoidReturn.attributes` would flag.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      // `async` with no `await` is deliberate here: it is how an implementation of a Promise-
      // returning interface (IPC handlers, test doubles) turns a synchronous throw into a rejection.
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Plain JS (build scripts, this file): no types to check against.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  // Command-line scripts talk to the person running them.
  {
    files: ['scripts/**', 'build/**'],
    rules: { 'no-console': 'off' },
  },

  // Electron main process and preload: Node.
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/renderer/**'], message: 'The main process must not import renderer code.' }] }],
    },
  },

  // Renderer: the browser, with React.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [eslintReact.configs['recommended-typescript']],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      // The two classic hook rules, from React's own plugin. Its v7 "recommended" also carries the
      // React Compiler's rules (refs, purity, set-state-in-effect, ...), which describe what the
      // compiler can optimise — this app does not use the compiler.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // @eslint-react repeats those under its own names; one report per problem is enough.
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/rules-of-hooks': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      // Naming opinions, not bugs: refs here are named for what they hold (`listRef`, `activeRef`,
      // but also `timer`, `pending`), and forcing a suffix would rename working code for nothing.
      '@eslint-react/naming-convention-ref-name': 'off',
      // Context isolation: the renderer reaches the system only through window.apiary (preload).
      'no-restricted-imports': ['error', {
        paths: [{ name: 'electron', message: 'The renderer has no Electron access; go through window.apiary (src/preload).' }],
        patterns: [
          { group: ['node:*'], message: 'The renderer runs in the browser; Node modules are main-process only.' },
          { group: ['**/main/**'], message: 'The renderer must not import main-process code; use the preload API.' },
        ],
      }],
    },
  },

  // Shared: imported by both sides, so it may assume neither.
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'electron', message: 'Shared code runs in both processes; keep Electron out of it.' }],
        patterns: [{ group: ['**/main/**', '**/renderer/**'], message: 'Shared code must not depend on either side.' }],
      }],
    },
  },

  // Unit and integration tests.
  {
    files: ['tests/unit/**/*.{ts,tsx}', 'tests/integration/**/*.ts'],
    extends: [vitest.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...vitest.environments.env.globals } },
  },

  // Component tests: the renderer in a real browser against a fake bridge (tests/component).
  {
    files: ['tests/component/**/*.{ts,tsx}'],
    extends: [vitest.configs.recommended],
    languageOptions: { globals: globals.browser },
  },

  // End-to-end tests and the screenshot script, which drive the app with Playwright.
  {
    files: ['tests/e2e/**/*.ts', 'scripts/*.spec.ts'],
    extends: [playwright.configs['flat/recommended']],
    languageOptions: { globals: globals.node },
    rules: {
      // Tests that branch on the platform, or on what a real Claude happened to print, are how
      // one spec covers macOS and Linux; the rule would only push that into untested helpers.
      'playwright/no-conditional-in-test': 'off',
    },
  },
])
