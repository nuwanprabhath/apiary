import { BrowserWindow } from 'electron'
import { IPC } from '@shared/api'
import { listAppWindows, previewAppWindow, raiseAppWindow, watchAppWindows } from '../../windows/appWindows'
import { windowNumberInUrl } from '../../windows/windowUrl'
import { broadcast } from '../../windows/broadcast'
import type { Handlers } from '../registrar'

type HandledKeys = 'appWindows' | 'appWindowRaise' | 'appWindowPreview'

const windows = { all: () => BrowserWindow.getAllWindows(), numberOf: windowNumberInUrl }

/**
 * The status bar's window buttons: this machine's windows, raising one, and a picture of one.
 * Every window hears `appWindowsChanged` when any of them changes.
 */
export function appWindowsHandlers(): { handlers: Pick<Handlers, HandledKeys>; dispose: () => void } {
  const watch = watchAppWindows(() => { broadcast(IPC.appWindowsChanged) })
  return {
    handlers: {
      appWindows: () => listAppWindows(windows),
      // Focus moving says so too, but not where nothing is focused (a headless run): raised, it is changed.
      appWindowRaise: (_e, windowNumber) => { if (raiseAppWindow(windows, windowNumber)) watch.changed() },
      appWindowPreview: (_e, windowNumber) => previewAppWindow(windows, windowNumber),
    },
    dispose: watch.stop,
  }
}
