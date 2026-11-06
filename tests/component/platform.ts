/**
 * Which system the renderer believes it runs on, for component tests. `setup.ts` puts every test on
 * a Mac before it starts, so a test reads the same on a Mac and on Linux CI; a test about another
 * system calls `asLinux()` first.
 */
const as = (userAgent: string): void => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent })
}

export const asMac = (): void => { as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Apiary') }

export const asLinux = (): void => { as('Mozilla/5.0 (X11; Linux x86_64) Apiary') }
