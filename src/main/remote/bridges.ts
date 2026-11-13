import { createLinkBridge, type LinkBridgeDeps } from './linkBridge'
import { createVsCodeBridge, type BridgeHandler, type VsCodeBridgeDeps } from './vscodeBridge'

/** Every `bridged` call's handler (`scopes.ts`): a link a terminal opens, and VS Code. */
export function createBridges(deps: VsCodeBridgeDeps & LinkBridgeDeps): BridgeHandler {
  const vsCode = createVsCodeBridge(deps)
  const links = createLinkBridge(deps)
  return (call) => (call.key === 'openTerminalLink' ? links(String(call.args[0]), call.w, call.connection) : vsCode(call))
}
