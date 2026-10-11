import type { JSX } from 'react'
import type { ThemeSpec } from '@shared/theme/spec'
import { PencilIcon, TrashIcon } from '../ui/icons'
import { Swatches, effectsLabel } from './ThemeSwatches'
import { activateTheme, deleteTheme } from '../state/theme'
import { surface } from '../state/policy'

export interface ThemeEntry {
  id: string | null
  spec: ThemeSpec
  saved: boolean
}

interface Props {
  all: ThemeEntry[]
  activeId: string | null
  /** A saved theme's rename button: it has been selected, now ask for its new name. */
  onRename: (spec: ThemeSpec) => void
}

/** Every theme there is, as cards; a saved one also has rename and delete. */
export function ThemeGrid({ all, activeId, onRename }: Props): JSX.Element {
  return (
    <div className="theme-grid" role="list">
      {all.map((t) => (
        <div key={t.id ?? 'original'} className="theme-card-wrap" role="listitem">
          <button
            className="theme-card"
            data-testid="theme-card"
            data-theme-id={t.id ?? 'original'}
            data-active={t.id === activeId}
            onClick={() => { surface(activateTheme(t.id), 'Could not apply the theme') }}
          >
            <Swatches spec={t.spec} />
            <span className="theme-card-name">{t.spec.name}</span>
            <span className="theme-card-effects">{effectsLabel(t.spec)}</span>
          </button>
          {t.saved && t.id !== null && (
            <span className="theme-card-actions">
              <button
                className="icon-button theme-card-action"
                data-testid="theme-card-rename"
                aria-label={`Rename ${t.spec.name}`}
                title="Rename"
                onClick={() => {
                  surface(activateTheme(t.id).then(() => { onRename(t.spec) }), 'Could not select the theme')
                }}
              >
                <PencilIcon />
              </button>
              <button
                className="icon-button theme-card-action"
                data-testid="theme-delete"
                aria-label={`Delete ${t.spec.name}`}
                title="Delete"
                onClick={() => { if (t.id !== null) surface(deleteTheme(t.id), 'Could not delete the theme') }}
              >
                <TrashIcon />
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
