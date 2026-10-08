import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useState } from 'react'
import { useResizeDrag } from '../../src/renderer/ui/useResizeDrag'
import { drag } from './helpers'
import { mountUi } from './mountUi'

interface Log { live: number[]; ended: number[] }

/** A 200px-wide box with a handle on its right edge; `grows` flips which arrows enlarge it. */
function Box({ log, grows }: { log: Log; grows?: 'forward' | 'back' }): React.JSX.Element {
  const [width, setWidth] = useState(200)
  const { dragging, separatorProps } = useResizeDrag({
    axis: 'col',
    value: width,
    min: 100,
    max: 300,
    label: 'Resize the box',
    grows,
    measure: (e, start) => Math.min(300, Math.max(100, start.value + e.clientX - start.x)),
    onLive: (w) => { log.live.push(w) },
    onEnd: (w) => { log.ended.push(w); setWidth(w) },
  })
  return (
    <div style={{ display: 'flex', width: 400 }}>
      <div data-testid="box" style={{ width }}>box</div>
      <div data-testid="handle" data-dragging={dragging} style={{ width: 10, height: 40, background: 'gray' }} {...separatorProps} />
    </div>
  )
}

const handle = (): HTMLElement | SVGElement => page.getByTestId('handle').element()

describe('useResizeDrag', () => {
  it('is a labelled, focusable separator with its value range', async () => {
    await mountUi(<Box log={{ live: [], ended: [] }} />)
    const h = handle()
    expect(h.getAttribute('role')).toBe('separator')
    expect(h.getAttribute('aria-orientation')).toBe('vertical')
    expect(h.getAttribute('aria-valuenow')).toBe('200')
    expect(h.getAttribute('aria-valuemin')).toBe('100')
    expect(h.getAttribute('aria-valuemax')).toBe('300')
    expect(h.getAttribute('aria-label')).toBe('Resize the box')
    expect(h.tabIndex).toBe(0)
  })

  it('a drag reports live values while it runs and commits exactly once, on release', async () => {
    const log: Log = { live: [], ended: [] }
    await mountUi(<Box log={log} />)
    await drag(handle(), 50, 0, 5)
    expect(log.live.length).toBeGreaterThan(1)
    expect(log.ended).toEqual([250])
    expect(document.body.classList.contains('resizing-active')).toBe(false)
    expect(handle().getAttribute('aria-valuenow')).toBe('250')
  })

  it('arrow keys step it, Home and End jump to the ends, and nothing leaves the range', async () => {
    const log: Log = { live: [], ended: [] }
    await mountUi(<Box log={log} />)
    handle().focus()
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{ArrowLeft}')
    await userEvent.keyboard('{End}')
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{Home}')
    await userEvent.keyboard('{ArrowLeft}')
    // 200 → 216 → 232 → 216 → 300 (End) → 300 (clamped) → 100 (Home) → 100 (clamped)
    expect(log.ended).toEqual([216, 232, 216, 300, 300, 100, 100])
    expect(log.live).toEqual([])
  })

  it('grows="back" makes the opposite arrow the enlarging one, and other keys are left alone', async () => {
    const log: Log = { live: [], ended: [] }
    await mountUi(<Box log={log} grows="back" />)
    handle().focus()
    await userEvent.keyboard('{ArrowLeft}')
    await userEvent.keyboard('a')
    await userEvent.keyboard('{ArrowUp}')
    expect(log.ended).toEqual([216])
  })
})
