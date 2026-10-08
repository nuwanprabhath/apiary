import { describe, it, expect } from 'vitest'
import { mountUi } from './mountUi'

/**
 * B6: `@keyframes chat-pulse` was defined twice in 33-chat.css and the later one (scale + fade)
 * won, so a running tool's dot grew and faded instead of pulsing. Each animation now has its own
 * name; this checks what the browser actually resolves.
 */
function keyframes(name: string): CSSKeyframesRule[] {
  const found: CSSKeyframesRule[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSKeyframesRule && rule.name === name) found.push(rule)
    }
  }
  return found
}

describe('chat pulse animations', () => {
  it('the pending tool dot pulses with the opacity-only chat-pulse', async () => {
    await mountUi(<div className="chat-tool" data-status="pending"><span className="chat-dot" /></div>)
    const dot = document.querySelector('.chat-dot') as HTMLElement
    expect(getComputedStyle(dot).animationName).toBe('chat-pulse')
    const rules = keyframes('chat-pulse')
    expect(rules).toHaveLength(1)
    const css = Array.from(rules[0].cssRules).map((r) => r.cssText).join(' ')
    expect(css).toContain('opacity')
    expect(css).not.toContain('transform')
  })

  it('the status-bar pulse ring keeps its own scale-and-fade animation', async () => {
    await mountUi(<span className="chat-status-pulse" />)
    const ring = document.querySelector('.chat-status-pulse') as HTMLElement
    expect(getComputedStyle(ring, '::after').animationName).toBe('chat-status-pulse')
    expect(keyframes('chat-status-pulse')).toHaveLength(1)
  })
})
