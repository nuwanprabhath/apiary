import type { JSX } from 'react'
import { cancelThemeGeneration } from '../state/theme'

interface Props {
  request: string
  busy: boolean
  error: string | null
  onRequest: (text: string) => void
  /** Start a design from the typed description. */
  onGenerate: () => void
}

/** The "Describe a theme" box: a description, Generate, and the busy and error lines. */
export function ThemeDescribe({ request, busy, error, onRequest, onGenerate }: Props): JSX.Element {
  return (
    <div className="theme-describe">
      <label className="theme-describe-label" htmlFor="theme-describe">
        <strong>Describe a theme</strong>
        <span className="settings-help">
          In your own words — &ldquo;like the Matrix movie&rdquo;, &ldquo;a calm forest at dusk&rdquo;. Claude
          designs it and you see it straight away; nothing changes until you keep it.
        </span>
      </label>
      <textarea
        id="theme-describe"
        className="theme-describe-input"
        data-testid="theme-describe"
        rows={2}
        maxLength={2000}
        value={request}
        disabled={busy}
        placeholder="A cool cyberpunk theme"
        onChange={(e) => { onRequest(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && request.trim() !== '' && !busy) { e.preventDefault(); onGenerate() }
        }}
      />
      <div className="theme-actions">
        {busy ? (
          <>
            <span className="theme-busy" data-testid="theme-generating"><span className="spinner-dot" /> Claude is designing — usually under a minute…</span>
            <button className="btn small" data-testid="theme-generate-cancel" onClick={() => cancelThemeGeneration()}>Cancel</button>
          </>
        ) : (
          <button
            className="btn primary small"
            data-testid="theme-generate"
            disabled={request.trim() === ''}
            onClick={onGenerate}
          >
            Generate
          </button>
        )}
      </div>
      {error !== null && <p className="theme-error" data-testid="theme-generate-error">{error}</p>}
    </div>
  )
}
