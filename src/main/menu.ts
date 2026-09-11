import { Menu, app, type MenuItemConstructorOptions } from 'electron'

export function buildMenu(
  onImport: () => void,
  onRefresh: () => void,
  onSettings: () => void,
  onNewSessionInFolder: () => void,
  onNewWindow: () => void,
): Menu {
  const isMac = process.platform === 'darwin'

  const macAppMenu: MenuItemConstructorOptions[] = isMac
    ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }]
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
      submenu: [{ role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ]

  return Menu.buildFromTemplate(template)
}
