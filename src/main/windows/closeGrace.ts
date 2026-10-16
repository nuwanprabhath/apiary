/**
 * How long a window closed while others are still open keeps its saved layout. Ubuntu's dock
 * "Quit" (and closing each window's X in turn) closes the windows one at a time with no app-level
 * quit first, so every window but the last would count as "closed by the user" and lose its
 * record. Windows that all close within this long of each other are a quit, and all come back;
 * one closed while the app carries on is dropped once it has passed.
 *
 * A minute where closing the last window quits (Linux, Windows): closing two windows by their X
 * buttons a few seconds apart is quitting there too (reproduced on Ubuntu 24.04). A Mac quits with
 * Cmd+Q, never by closing windows, so a window closed there and a Cmd+Q a little later must not
 * bring it back: it keeps the short one.
 */
export function closeGraceMs(platform: NodeJS.Platform): number {
  return platform === 'darwin' ? 3000 : 60_000
}
