/** Chromium with no display at all: no window can open, and none is needed for the remote server. */
export const NO_DISPLAY_SWITCH = '--ozone-platform=headless'

/** Chromium as an X11 client, which on a Wayland desktop runs through XWayland (`needsXWayland`). */
export const XWAYLAND_SWITCH = '--ozone-platform=x11'
