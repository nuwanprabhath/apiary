/**
 * The window grid's columns. The same for a torn-off window as any other: it keeps the sidebar
 * (hidden to the rail by default, see uiState), so the library is never out of reach from it.
 *
 * UI-6: `var(--drag-sidebar-width, …)` reads the live value the drag writes straight onto the
 * layout element during a resize, falling back to the committed width the rest of the time
 * (including the instant after `mouseup`, once the property is removed and before the state's
 * render lands — both name the same width).
 */
export function layoutGridColumns(sidebarHidden: boolean, sidebarWidth: number): string {
  return sidebarHidden
    ? 'var(--sidebar-rail-width) 1fr'
    : `var(--drag-sidebar-width, ${String(sidebarWidth)}px) max(var(--panel-gap), 4px) 1fr`
}
