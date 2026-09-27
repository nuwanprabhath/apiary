import { describe, it, expect, vi } from 'vitest'
import { registerEscapeLayer, type EscapeEventTarget } from '../../src/renderer/ui/useEscape'

/** A minimal, in-memory stand-in for `document` — just enough of `EscapeEventTarget` to drive the
 *  stack in Node, with no DOM at all. */
function fakeDocument(): EscapeEventTarget & { fireEscape: () => void } {
  const listeners: Array<(e: KeyboardEvent) => void> = []
  return {
    addEventListener: (_type, listener) => { listeners.push(listener) },
    removeEventListener: (_type, listener) => {
      const i = listeners.indexOf(listener)
      if (i !== -1) listeners.splice(i, 1)
    },
    fireEscape: () => {
      const event = { key: 'Escape', stopPropagation: vi.fn() } as unknown as KeyboardEvent
      for (const l of [...listeners]) l(event)
    },
  }
}

describe('registerEscapeLayer (UI-13)', () => {
  // The stack is module-level (shared by every real caller, on purpose — see useEscape.ts), so a
  // layer left registered by one test would leak into the next. Every test unregisters everything
  // it registers, the same discipline a real component gets for free from its effect cleanup.

  it('calls the only registered layer on Escape', () => {
    const doc = fakeDocument()
    const onEscape = vi.fn()
    const unregister = registerEscapeLayer(onEscape, doc)
    doc.fireEscape()
    expect(onEscape).toHaveBeenCalledTimes(1)
    unregister()
  })

  it('only the top-most layer fires — an inner popup does not also close the dialog behind it', () => {
    const doc = fakeDocument()
    const outer = vi.fn()
    const inner = vi.fn()
    const unregisterOuter = registerEscapeLayer(outer, doc)
    const unregisterInner = registerEscapeLayer(inner, doc)
    doc.fireEscape()
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
    unregisterInner()
    unregisterOuter()
  })

  it('popping the top layer lets the next one down handle the following Escape', () => {
    const doc = fakeDocument()
    const outer = vi.fn()
    const inner = vi.fn()
    const unregisterOuter = registerEscapeLayer(outer, doc)
    const unregisterInner = registerEscapeLayer(inner, doc)
    unregisterInner()
    doc.fireEscape()
    expect(outer).toHaveBeenCalledTimes(1)
    expect(inner).not.toHaveBeenCalled()
    unregisterOuter()
  })

  it('does nothing once every layer has unregistered', () => {
    const doc = fakeDocument()
    const onEscape = vi.fn()
    const unregister = registerEscapeLayer(onEscape, doc)
    unregister()
    doc.fireEscape()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('removes its document listener once the stack is empty, and re-adds it for the next layer', () => {
    const doc = fakeDocument()
    const addSpy = vi.spyOn(doc, 'addEventListener')
    const removeSpy = vi.spyOn(doc, 'removeEventListener')
    const unregister = registerEscapeLayer(vi.fn(), doc)
    expect(addSpy).toHaveBeenCalledTimes(1)
    unregister()
    expect(removeSpy).toHaveBeenCalledTimes(1)
    registerEscapeLayer(vi.fn(), doc)()
    expect(addSpy).toHaveBeenCalledTimes(2)
  })
})
