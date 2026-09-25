import '@vitest/browser/context'

declare module '@vitest/browser/context' {
  interface BrowserCommands {
    mouse: (action: 'move' | 'down' | 'up' | 'wheel', x?: number, y?: number, steps?: number) => Promise<void>
  }
}
