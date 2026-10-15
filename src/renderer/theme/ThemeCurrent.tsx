import type { JSX } from 'react'
import type { ThemeSpec } from '@shared/theme/spec'
import { Swatches, effectsLabel } from './ThemeSwatches'
import { activateTheme } from '../state/theme'
import { surface } from '../state/policy'
import { focusAskedFor } from '../ui/focusUnlessTyping'

export type Naming = null | 'save' | 'rename' | 'save-preview'

interface Props {
  current: { id: string | null; spec: ThemeSpec; saved: boolean }
  activeId: string | null
  naming: Naming
  name: string
  onName: (name: string) => void
  onSubmitName: () => void
  /** Start naming: a copy, or a rename, prefilled with `name`. */
  onStartNaming: (kind: 'save' | 'rename', name: string) => void
  onCancelNaming: () => void
}

/** The theme in use: its name and swatches, and the buttons (or the name field) to copy or rename it. */
export function ThemeCurrent(
  { current, activeId, naming, name, onName, onSubmitName, onStartNaming, onCancelNaming }: Props,
): JSX.Element {
  return (
    <div className="theme-current" data-testid="theme-current">
      <div className="theme-current-head">
        <strong data-testid="theme-current-name">{current.spec.name}</strong>
        <Swatches spec={current.spec} />
      </div>
      <span className="settings-help">{effectsLabel(current.spec)}</span>
      {naming !== null ? (
        <form className="theme-name-form" onSubmit={(e) => { e.preventDefault(); onSubmitName() }}>
          <input
            ref={focusAskedFor}
            className="search"
            data-testid="theme-save-name"
            value={name}
            maxLength={60}
            placeholder="Theme name"
            onChange={(e) => { onName(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              // Without this, Escape bubbles to SettingsDialog's own document-level listener and
              // closes the whole dialog (reverting any preview) instead of just this input.
              e.stopPropagation()
              onCancelNaming()
            }}
          />
          <button type="submit" className="btn primary small" data-testid="theme-save-confirm">
            {naming === 'rename' ? 'Rename' : 'Save'}
          </button>
          <button type="button" className="btn small" onClick={onCancelNaming}>Cancel</button>
        </form>
      ) : (
        <div className="theme-actions">
          <button
            className="btn small"
            data-testid="theme-reset"
            disabled={activeId === null}
            onClick={() => { surface(activateTheme(null), 'Could not reset the theme') }}
          >
            Reset to original
          </button>
          <button
            className="btn small"
            data-testid="theme-save-as"
            disabled={current.id === null}
            title={current.id === null ? 'The original look is always here; there is nothing to copy' : 'Save a copy under a new name'}
            onClick={() => { onStartNaming('save', `${current.spec.name} copy`) }}
          >
            Save as…
          </button>
          {current.saved && (
            <button className="btn small" data-testid="theme-rename" onClick={() => { onStartNaming('rename', current.spec.name) }}>
              Rename
            </button>
          )}
        </div>
      )}
    </div>
  )
}
