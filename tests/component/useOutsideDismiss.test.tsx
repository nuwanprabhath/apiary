import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createPortal } from 'react-dom'
import { useRef, useState } from 'react'
import { useOutsideDismiss } from '../../src/renderer/ui/useOutsideDismiss'
import { mountUi } from './mountUi'

function Popup({ enabled = true, onStop }: { enabled?: boolean; onStop?: boolean }): React.JSX.Element {
  const root = useRef<HTMLDivElement | null>(null)
  const [dismissed, setDismissed] = useState(0)
  useOutsideDismiss(() => { setDismissed((n) => n + 1) }, { enabled, inside: [root], insideSelector: '.layer' })
  return (
    <div>
      <output data-testid="count">{dismissed}</output>
      <div ref={root} data-testid="inside"><button data-testid="inner">inner</button></div>
      {/* A layer in the body: a React child of this component, not a DOM descendant of `root`. */}
      {createPortal(<div className="layer" data-testid="layer"><button data-testid="portal-button">portalled</button></div>, document.body)}
      <button data-testid="outside">outside</button>
      <button
        data-testid="stopper"
        // A handler further down that swallows its own pointerdown.
        onPointerDown={onStop === true ? (e) => { e.stopPropagation() } : undefined}
      >
        stopper
      </button>
    </div>
  )
}

const count = (): string => page.getByTestId('count').element().textContent

describe('useOutsideDismiss', () => {
  it('dismisses on a press outside, not on a press inside the ref or in a portalled layer', async () => {
    await mountUi(<Popup />)
    await userEvent.click(page.getByTestId('inner'))
    await userEvent.click(page.getByTestId('portal-button'))
    expect(count()).toBe('0')
    await userEvent.click(page.getByTestId('outside'))
    await expect.poll(count).toBe('1')
  })

  it('still hears a press whose target stops its own propagation (capture phase)', async () => {
    await mountUi(<Popup onStop />)
    await userEvent.click(page.getByTestId('stopper'))
    await expect.poll(count).toBe('1')
  })

  it('dismisses on the press, before the click completes, so the other button still gets its click', async () => {
    const seen: string[] = []
    await mountUi(<Popup />)
    page.getByTestId('outside').element().addEventListener('click', () => { seen.push(`click after ${count()}`) })
    await userEvent.click(page.getByTestId('outside'))
    expect(seen).toContain('click after 1')
  })

  it('listens only while enabled', async () => {
    const m = await mountUi(<Popup enabled={false} />)
    await userEvent.click(page.getByTestId('outside'))
    expect(count()).toBe('0')
    await m.rerender(<Popup enabled />)
    await userEvent.click(page.getByTestId('outside'))
    await expect.poll(count).toBe('1')
  })
})
