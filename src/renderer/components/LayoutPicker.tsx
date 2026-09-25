import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { PRESETS, capacity, type PresetId } from '../state/layout'

const GAP = 6
const MARGIN = 8
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
}

/**
 * The layout picker: the eight presets as thumbnails, in the style of the macOS window-tiling menu
 * and Windows' Snap Layouts.
 *
 * In place mode every zone of every thumbnail is its own button, so "put this session *there*" is
 * one click on the exact spot. Portalled and fixed like the hover card, for the same reason: it is
 * opened from inside scrolling containers that would clip it.
 */
export function LayoutPicker({
  anchor, mode, heading, current, onPick, onClose, onPointerEnter, onPointerLeave,
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    // Beside the button, not beneath it. Directly below puts the picker on top of the next
    // session rows, so the pointer travelling to it crosses them — and each one it crosses arms
    // its own hover card, which takes the gesture away before the picker can be clicked. To the
    // right there is nothing between the button and the menu.
    const right = anchor.right + GAP
    const left = right + box.width + MARGIN <= window.innerWidth
      ? right
      : Math.max(MARGIN, anchor.left - GAP - box.width)
    // Top-aligned with the button, pulled up only as far as staying on screen requires.
    const top = Math.max(MARGIN, Math.min(anchor.top, window.innerHeight - box.height - MARGIN))
    setPos({ left, top })
  }, [anchor])

  // Focus the first target once the picker actually has a position — not in the same effect that
  // computes `pos`, because at that point the div is still rendered with `visibility: hidden` (the
  // very first render, before its size can be measured), and a hidden element silently refuses
  // focus. Keyed on `pos === null` rather than `pos` itself so a later reposition (the window
  // resizing while the picker is open) doesn't steal focus back from whatever the arrow keys moved
  // it to.
  const hasPos = pos !== null
  useEffect(() => {
    if (!hasPos) return
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [hasPos])

  // A document-level listener rather than relying on DOM focus being inside the picker: a plain
  // click on the button that opened it (as opposed to the hover path, which focuses the picker's
  // own first target) can leave native focus sitting on that outer button, where the div's own
  // onKeyDown below would never see the key. Every other popup in the app closes on Escape this
  // same way (GitMenu, BranchSwitcher, ContextMenu) for the same reason.
  useEffect(() => {
    const onDocKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onDocKeyDown)
    return () => document.removeEventListener('keydown', onDocKeyDown)
  }, [onClose])

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
    <div
      ref={ref}
      className="layout-picker"
      data-testid="layout-picker"
      data-mode={mode}
      role="dialog"
      aria-label={heading}
      style={pos === null ? { visibility: 'hidden', left: 0, top: 0 } : pos}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      // As with the hover card: a portal still bubbles React events to whatever rendered it, and a
      // row that hides things on mousedown would unmount this before the click landed.
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
    </div>,
    document.body,
  )
}
