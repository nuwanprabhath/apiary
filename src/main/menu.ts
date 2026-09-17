import { Menu, app, type MenuItemConstructorOptions } from 'electron'

export function buildMenu(
  onImport: () => void,
  onRefresh: () => void,
  onSettings: () => void,
  onNewSessionInFolder: () => void,
  onNewWindow: () => void,
  onCheckForUpdates: () => void,
  onToggleSidebar: () => void = () => {},
): Menu {
  const isMac = process.platform === 'darwin'

  const macAppMenu: MenuItemConstructorOptions[] = isMac
    ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        // Where every Mac app keeps it, directly under About — the two questions "what am I
        // running" and "is there something newer" are asked in the same breath.
        { label: 'Check for Updates...', click: onCheckForUpdates },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }]
    : []

  const template: MenuItemConstructorOptions[] = [
    ...macAppMenu,
    {
      label: 'File',
      submenu: [
        {
          // A second workspace over the same sessions: the windows share one set of terminals and
          // one store, but each keeps its own tabs and columns.
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: onNewWindow,
        },
        { type: 'separator' },
        {
          label: 'Import Claude Sessions...',
          accelerator: 'CmdOrCtrl+I',
          click: onImport,
        },
        {
          label: 'Rescan Sessions',
          accelerator: 'CmdOrCtrl+R',
          click: onRefresh,
        },
        { type: 'separator' },
        {
          id: 'new-session-in-folder',
          label: 'New Session in Folder...',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: onNewSessionInFolder,
        },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: onSettings,
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          // Cmd+B is VS Code's, and costs nothing on a Mac. Plain Ctrl+B is not free anywhere else:
          // a menu accelerator is taken before the page sees the key, and in a terminal Ctrl+B is
          // the shell's back-one-character (and tmux's prefix).
          accelerator: isMac ? 'Cmd+B' : 'Ctrl+Shift+B',
          click: onToggleSidebar,
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    // Non-Mac has no application menu to put it in, so it goes where Linux and Windows apps keep
    // it instead. On Mac it is already under the Apiary menu and a second copy would be clutter.
    ...(isMac ? [] : [{
      label: 'Help',
      submenu: [{ label: 'Check for Updates...', click: onCheckForUpdates }],
    } as MenuItemConstructorOptions]),
  ]

  return Menu.buildFromTemplate(template)
}
