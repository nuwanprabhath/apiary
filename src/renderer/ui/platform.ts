/**
 * The one place the renderer asks which system it runs on. Each answer is read when called, never
 * once at import, so a component test can stand in for another system (tests/component/platform.ts)
 * and the tests behave the same on a Mac and on Linux CI.
 */
export const isMac = (): boolean => navigator.userAgent.includes('Mac')

export const isLinux = (): boolean => navigator.userAgent.includes('Linux')

/** ⌘ on a Mac, Ctrl elsewhere, held without the other one. */
export const primaryModifier = (e: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
