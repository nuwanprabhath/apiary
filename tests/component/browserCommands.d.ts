import 'vitest/browser'

// Vitest 5 moved the browser-mode entry point from `@vitest/browser/context` to `vitest/browser`
// (the old subpath now just throws a "must run in Browser Mode" guard). `vitest/browser` re-exports
// `commands: BrowserCommands`, but the interface itself now lives in `vitest/internal/browser` —
// augmenting `vitest/browser` here does not reach the type `commands` is actually typed with.
declare module 'vitest/internal/browser' {
  interface BrowserCommands {
    mouse: (action: 'move' | 'down' | 'up' | 'wheel', x?: number, y?: number, steps?: number) => Promise<void>
    emulateMedia: (reduceMotion: 'reduce' | 'no-preference') => Promise<void>
  }
}
