import { PetRenderer, RENDER_PX } from './render'
import { renderLoop, type FromRenderer, type ToRenderer } from './renderLoop'

/**
 * Renders pets off the main thread, on an OffscreenCanvas. A pet's fur is a few thousand draw
 * calls; none of them is the page's business.
 */
const handle = renderLoop(() => new PetRenderer(new OffscreenCanvas(RENDER_PX, RENDER_PX)), (msg: FromRenderer) => { postMessage(msg) })
addEventListener('message', (e: MessageEvent<ToRenderer>) => { handle(e.data) })
