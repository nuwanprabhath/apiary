import { shell } from 'electron'
import type { AppService } from '../../appService'
import type { Handlers } from '../registrar'

export interface PluginsDeps {
  service: AppService
}

type HandledKeys = 'pluginBarItems' | 'pluginBarRefresh' | 'pluginRunAction' | 'pluginList'
  | 'statusBarItems' | 'statusBarRefresh' | 'statusBarPanel'

export function pluginsHandlers(deps: PluginsDeps): Pick<Handlers, HandledKeys> {
  const { service } = deps

  return {
    pluginBarItems: (_e, terminal) => service.pluginBarItems(terminal),
    pluginBarRefresh: (_e, terminal) => service.refreshPluginBar(terminal),
    pluginList: () => service.listPlugins(),
    statusBarItems: () => service.statusBar.items(),
    statusBarRefresh: (_e, pluginId) => service.statusBar.refresh(pluginId),
    statusBarPanel: (_e, pluginId, itemId) => service.statusBar.panel(pluginId, itemId),
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
