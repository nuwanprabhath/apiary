import './renderTracker'
import { afterEach, beforeEach } from 'vitest'
import { createFakeApiary } from './fakeApiary'
import { unmountApp } from './renderApp'
import { setTestSeams } from '../../src/renderer/state/testSeams'

// Installed before any test file imports the renderer, for code that reads the bridge as a module
// loads; `renderApp` replaces it with the test's own fake.
window.apiary = createFakeApiary()
// Pets are drawn flat here unless a test is about the 3D renderer (see `petsFlat` in state/testSeams.ts).
setTestSeams({ petsFlat: true })
// ...and stand still in the window: the tests about pets in the layer are about what they do, not
// how they move, and a minute of breathing and walking in software compositing starved the drag
// tests running beside them. (petSprite.test.tsx draws pets outside the layer, animations on.)
const stillPets = document.createElement('style')
stillPets.textContent = '.pet-layer .pet, .pet-layer .pet * { animation: none !important; transition: none !important; }'
document.head.append(stillPets)

/**
 * Console errors, window errors and unhandled rejections are otherwise invisible noise: Vitest
 * prints them as `stderr |` lines but a test that triggers one still passes. That let a real
 * unmount race print in dozens of unrelated component tests for a long time before anyone
 * noticed (TEST-14). A test that deliberately provokes an error — errorReporting.test.tsx's two
 * cases — calls `expectConsoleError` first so this guard does not fail it.
 *
 * State lives on `window` rather than in this module's own closure: Vite/Vitest browser mode can
 * load this file twice under different URLs (once as a configured `setupFile`, once again when a
 * test file does `import { expectConsoleError } from './setup'`), each getting its own module
 * instance with its own closure — a push from the test file's copy would then be invisible to the
 * copy whose listeners and `afterEach` actually run. `window` is the one thing both copies agree
 * on: it is the real browser page they share.
 */
const DEFAULT_ALLOWED: RegExp[] = [
  // React logs a caught render error as *two* separate console.error calls: the error itself
  // (which a test allows with its own pattern, e.g. `expectConsoleError(/DELIBERATE_.../)`), and
  // this second, generic one carrying only the component stack and no part of the error's own
  // message. Always allowed, since on its own it never says whether the error it came with was
  // expected — that judgement is made by the first call, which still has to match a pattern.
  /React will try to recreate this component tree from scratch/,
]

interface ConsoleErrorGuard { allowed: RegExp[]; unexpected: string[] }
declare global { interface Window { __consoleErrorGuard?: ConsoleErrorGuard } }

function guard(): ConsoleErrorGuard {
  window.__consoleErrorGuard ??= { allowed: [...DEFAULT_ALLOWED], unexpected: [] }
  return window.__consoleErrorGuard
}

export function expectConsoleError(pattern: RegExp): void {
  guard().allowed.push(pattern)
}

function record(message: string): void {
  const g = guard()
  if (g.allowed.some((pattern) => pattern.test(message))) return
  g.unexpected.push(message)
}

/** Best-effort text for whatever a console.error/window error/unhandledrejection handed us: an
 *  Error's stack, a PromiseRejectionEvent's `.reason` (Vitest's own browser error-catcher logs the
 *  raw event, not the reason, so `String()` alone would only ever produce
 *  "[object PromiseRejectionEvent]"), or the plain string form of anything else. */
function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === 'object' && value !== null && 'reason' in value) {
    return describe(value.reason)
  }
  return String(value)
}

// Listeners are attached once per page, guarded the same way as the state above — a second module
// instance must not double-report every error.
if (!window.__consoleErrorGuard) {
  guard()
  const realConsoleError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    record(args.map(describe).join(' '))
    realConsoleError(...args)
  }
  window.addEventListener('error', (e) => { record(describe(e.error ?? e.message)) })
  window.addEventListener('unhandledrejection', (e) => { record(describe(e.reason)) })
}

beforeEach(() => {
  window.__consoleErrorGuard = { allowed: [...DEFAULT_ALLOWED], unexpected: [] }
})

afterEach(() => {
  unmountApp()
  // The renderer keeps UI state (collapsed folders, widths, pins, the open tab) in localStorage,
  // per window — cleared so no test starts where the last one left off.
  localStorage.clear()
  const unexpected = window.__consoleErrorGuard?.unexpected ?? []
  if (unexpected.length > 0) {
    throw new Error(`Unexpected console/window error(s), see stderr above:\n${unexpected.join('\n---\n')}`)
  }
})
