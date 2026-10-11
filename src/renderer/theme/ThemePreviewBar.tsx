import type { JSX } from 'react'
import type { ThemeSpec } from '@shared/theme/spec'
import { Swatches, effectsLabel } from './ThemeSwatches'
import { activateTheme, saveTheme } from '../state/theme'
import { surface } from '../state/policy'

export interface Preview {
  /** Every version so far, oldest first, at most HISTORY. */
  history: ThemeSpec[]
  index: number
  /** What validation changed in the version on screen, if anything. */
  note: string | null
  /** The description it started from — saved with the theme. */
  prompt: string
}

interface Props {
  preview: Preview
  /** The version on screen. */
  shown: ThemeSpec
  refine: string
  busy: boolean
  onRefine: (text: string) => void
  onRefineSubmit: () => void
  onStep: (preview: Preview) => void
  onKept: () => void
  onSaveAs: () => void
  onDiscard: () => void
}

/** What a generated theme offers while it is only a preview: refine, step through versions, keep or drop. */
export function ThemePreviewBar(
  { preview, shown, refine, busy, onRefine, onRefineSubmit, onStep, onKept, onSaveAs, onDiscard }: Props,
): JSX.Element {
  return (
    <div className="theme-preview-bar" data-testid="theme-preview-bar">
      <div className="theme-current-head">
        <span><span className="settings-help">Previewing</span> <strong data-testid="theme-preview-name">{shown.name}</strong></span>
        <Swatches spec={shown} />
      </div>
      <span className="settings-help">{effectsLabel(shown)}</span>
      {preview.note !== null && <span className="settings-help theme-note" data-testid="theme-preview-note">{preview.note}</span>}
      <form className="theme-name-form" onSubmit={(e) => { e.preventDefault(); if (refine.trim() !== '' && !busy) onRefineSubmit() }}>
        <input
          className="search"
          data-testid="theme-refine"
          value={refine}
          disabled={busy}
          maxLength={2000}
          placeholder="Adjust it — more green, less glow, rounder corners"
          onChange={(e) => { onRefine(e.target.value) }}
        />
        <button type="submit" className="btn small" data-testid="theme-refine-submit" disabled={busy || refine.trim() === ''}>Refine</button>
      </form>
      <div className="theme-actions">
        <button
          className="btn small"
          data-testid="theme-history-back"
          disabled={busy || preview.index === 0}
          title="The previous version"
          onClick={() => { onStep({ ...preview, index: preview.index - 1, note: null }) }}
        >
          ◀
        </button>
        <button
          className="btn small"
          data-testid="theme-history-forward"
          disabled={busy || preview.index === preview.history.length - 1}
          title="The next version"
          onClick={() => { onStep({ ...preview, index: preview.index + 1, note: null }) }}
        >
          ▶
        </button>
        <span className="theme-actions-spacer" />
        <button
          className="btn primary small"
          data-testid="theme-keep"
          disabled={busy}
          onClick={() => {
            surface(saveTheme(shown.name, shown, preview.prompt).then((saved) => {
              onKept()
              return activateTheme(saved.id)
            }), 'Could not keep the theme')
          }}
        >
          Keep
        </button>
        <button className="btn small" data-testid="theme-preview-save-as" disabled={busy} onClick={onSaveAs}>
          Save as…
        </button>
        <button className="btn small" data-testid="theme-discard" disabled={busy} onClick={onDiscard}>Discard</button>
      </div>
    </div>
  )
}
