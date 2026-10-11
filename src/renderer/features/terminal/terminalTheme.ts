import type { ITheme } from '@xterm/xterm'

/**
 * xterm paints from a JS palette rather than from CSS, so it cannot pick up the stylesheet's
 * design tokens by itself. Reading them off the document at mount keeps the terminal inside the
 * same theming contract as the rest of the UI — see the token block at the top of styles.css —
 * so a future theme recolours the terminal without needing a second palette defined over here.
 */
export function themeFromTokens(): ITheme {
  const css = getComputedStyle(document.documentElement)
  // Fall back to the original look's values: getPropertyValue returns '' for an unknown
  // property, and handing xterm an empty string paints an invisible terminal.
  const token = (name: string, fallback: string): string => {
    const value = css.getPropertyValue(name).trim()
    return value !== '' ? value : fallback
  }
  return {
    background: token('--term-background', '#151618'),
    foreground: token('--term-foreground', '#e6e6e6'),
    cursor: token('--term-cursor', '#e6e6e6'),
    selectionBackground: token('--term-selection', '#2f3238'),
    black: token('--term-black', '#1b1c1e'),
    red: token('--term-red', '#e0736d'),
    green: token('--term-green', '#58c06e'),
    yellow: token('--term-yellow', '#e3b341'),
    blue: token('--term-blue', '#6cb6ff'),
    magenta: token('--term-magenta', '#b385f5'),
    cyan: token('--term-cyan', '#56c8d8'),
    white: token('--term-white', '#d0d0d0'),
    brightBlack: token('--term-bright-black', '#6b7075'),
    brightRed: token('--term-bright-red', '#ff8f88'),
    brightGreen: token('--term-bright-green', '#7ee08f'),
    brightYellow: token('--term-bright-yellow', '#f5cd6a'),
    brightBlue: token('--term-bright-blue', '#94cbff'),
    brightMagenta: token('--term-bright-magenta', '#cda6ff'),
    brightCyan: token('--term-bright-cyan', '#86e1ec'),
    brightWhite: token('--term-bright-white', '#ffffff'),
  }
}

/** The terminal's font stack — the theme's monospace choice, via the same token the page uses. */
export function fontFromTokens(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  return value !== '' ? value : 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
}
