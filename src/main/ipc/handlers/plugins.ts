import { shell } from 'electron'
import type { PluginService } from '../../plugins/pluginService'
import { IPC } from '@shared/api'
import { broadcast } from '../../windows/broadcast'
import type { Handlers } from '../registrar'

export interface PluginsDeps {
  plugins: PluginService
}

type HandledKeys = 'pluginBarItems' | 'pluginBarRefresh' | 'pluginRunAction' | 'pluginList'
  | 'statusBarItems' | 'statusBarRefresh' | 'statusBarPanel' | 'statusBarConsent'

export function pluginsHandlers(deps: PluginsDeps): Pick<Handlers, HandledKeys> {
  const { plugins } = deps

  return {
    pluginBarItems: (_e, terminal) => plugins.barItems(terminal),
    pluginBarRefresh: (_e, terminal) => plugins.refreshBar(terminal),
    pluginList: () => plugins.list(),
    statusBarItems: () => plugins.statusBarItems(),
    statusBarRefresh: (_e, pluginId) => plugins.statusBarRefresh(pluginId),
    statusBarPanel: (_e, pluginId, itemId) => plugins.statusBarPanel(pluginId, itemId),
    statusBarConsent: (_e, pluginId, allow) => {
      plugins.statusBarConsent(pluginId, allow)
      // A declined plugin is now off, which Settings → Plugins and every bar should show.
      if (!allow) broadcast(IPC.pluginsChanged)
    },
    pluginRunAction: async (_e, item) => {
      if (item.action.kind !== 'open-url') return
      /*
       * Checked here rather than trusted from the renderer.
       *
       * The URL originates in a plugin, but it arrives back over IPC, and `shell.openExternal`
       * will happily hand the OS anything — `file:`, and on some platforms schemes that run
       * things. Only http(s) is ever opened, so the worst a compromised renderer can do with this
       * channel is open a web page.
       */
      let url: URL
      try {
        url = new URL(item.action.url)
      } catch {
        return
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return
      await shell.openExternal(url.toString())
    },
  }
}
