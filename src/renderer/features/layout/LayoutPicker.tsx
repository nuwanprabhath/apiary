import { type JSX, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Popover } from '../../ui/Popover'
import { PRESETS, capacity, type PresetId } from '../../state/layout'
import { useEscape } from '../../ui/useEscape'
import { focusUnlessTyping } from '../../ui/focusUnlessTyping'
import { clampTop, fitsHorizontally, POPOVER_GAP, POPOVER_MARGIN } from '../../ui/popoverPlacement'

const PER_ROW = 4

interface Props {
  anchor: DOMRect
  /** `place`: each zone is a target. `layout`: each thumbnail is one. */
  mode: 'place' | 'layout'
  heading: string
  current: PresetId
  onPick: (preset: PresetId, zone: number) => void
  onClose: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  /**
   * Whether this open should take keyboard focus. True for a click, a keyboard activation or
   * `requestPicker`'s context-menu picker. False when the pointer merely stopped over a button:
   * resting there while typing in the composer or a terminal must not steal the keystrokes.
   */
  focusOnOpen: boolean
}

/** Portalled and fixed like the hover card, since it opens from inside scrolling containers that would clip it. */
export function LayoutPicker({
  anchor, mode, heading, current, onPick, onClose, onPointerEnter, onPointerLeave, focusOnOpen,
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Focus is given back on every way the picker goes away, including the parent unmounting it
  // from `scheduleClose`, which calls no callback here. Captured once with `focusOnOpen`: a
  // hover-opened picker never took focus, so has nothing to give back.
  const previousActiveRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const focusOnOpenAtMountRef = useRef(focusOnOpen)
  useEffect(() => () => {
    if (focusOnOpenAtMountRef.current) focusUnlessTyping(previousActiveRef.current)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    // Beside the button, not beneath it: below, the pointer would cross the next session rows,
    // and each arms its own hover card, which takes the gesture away.
    const right = anchor.right + POPOVER_GAP
    const left = fitsHorizontally(right, box.width)
      ? right
      : Math.max(POPOVER_MARGIN, anchor.left - POPOVER_GAP - box.width)
    setPos({ left, top: clampTop(anchor.top, box.height) })
  }, [anchor])

  // Focus the first target once placed: until then the div is `visibility: hidden`, which refuses
  // focus. Keyed on `pos === null`, not `pos`, so a later reposition does not steal focus back
  // from where the arrow keys moved it.
  const hasPos = pos !== null
  useEffect(() => {
    if (!hasPos || !focusOnOpen) return
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [hasPos, focusOnOpen])

  // The shared Escape stack, not DOM focus: after a plain click, native focus can stay on the
  // opening button, where the div's onKeyDown would never see the key. Only the top-most layer
  // reacts, so a dialog this was opened from is not also closed.
  useEscape(onClose)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button[data-preset]') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at === -1) return
    const focus = (i: number): void => { buttons[Math.max(0, Math.min(buttons.length - 1, i))]?.focus() }
    if (e.key === 'ArrowRight') { e.preventDefault(); focus(at + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); focus(at - 1) }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const here = buttons[at]
      const presetIndex = PRESETS.findIndex((p) => p.id === here.dataset.preset)
      const targetIndex = presetIndex + (e.key === 'ArrowDown' ? PER_ROW : -PER_ROW)
      const target = PRESETS[targetIndex]
      if (target === undefined) return
      const zone = Math.min(Number(here.dataset.zone ?? 0), capacity(target.id) - 1)
      const next = buttons.findIndex((b) => b.dataset.preset === target.id && Number(b.dataset.zone ?? 0) === zone)
      if (next !== -1) focus(next)
    }
  }

  return createPortal(
    <Popover
      ref={ref}
      className="layout-picker"
      testId="layout-picker"
      data-mode={mode}
      label={heading}
      // It moves focus itself, and a hover-opened picker has no focused control to return to.
      restoreFocus={false}
      style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      // A portal still bubbles React events to what rendered it, and a row that hides things on
      // mousedown would unmount this before the click landed.
      onMouseDown={(e) => { e.stopPropagation() }}
      onKeyDown={onKeyDown}
    >
      <div className="layout-picker-heading">{heading}</div>
      <div className="layout-picker-grid">
        {PRESETS.map((p) => {
          const zones = Array.from({ length: capacity(p.id) }, (_, i) => i)
          const style = {
            gridTemplateColumns: `repeat(${String(p.cols)}, 1fr)`,
            gridTemplateRows: `repeat(${String(p.rows)}, 1fr)`,
            gridTemplateAreas: p.areas.map((row) => `"${row}"`).join(' '),
          }
          if (mode === 'layout') {
            return (
              <button
                key={p.id}
                className="layout-thumb"
                data-testid={`layout-option-${p.id}`}
                data-preset={p.id}
                data-current={p.id === current}
                title={p.label}
                aria-label={p.label}
                style={style}
                onClick={() => { onPick(p.id, 0) }}
              >
                {zones.map((z) => <span key={z} className="layout-zone" style={{ gridArea: `z${String(z + 1)}` }} />)}
              </button>
            )
          }
          return (
            <div
              key={p.id}
              className="layout-thumb"
              data-testid={`layout-option-${p.id}`}
              data-current={p.id === current}
              style={style}
            >
              {zones.map((z) => (
                <button
                  key={z}
                  className="layout-zone"
                  data-testid={`layout-zone-${p.id}-${String(z + 1)}`}
                  data-preset={p.id}
                  data-zone={z}
                  title={`${p.label} — position ${String(z + 1)}`}
                  aria-label={`${p.label}, position ${String(z + 1)}`}
                  style={{ gridArea: `z${String(z + 1)}` }}
                  onClick={() => { onPick(p.id, z) }}
                />
              ))}
            </div>
          )
        })}
      </div>
    </Popover>,
    document.body,
  )
}
