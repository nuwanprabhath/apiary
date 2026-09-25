import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PALETTE, ORIGINAL_THEME, type ThemeSpec, type PaletteToken } from '@shared/theme/spec'
import { useThemeState } from '../theme/useTheme'
import { applyTheme } from '../theme/applyTheme'
import { useNotifications } from '../state/notifications'
import { PencilIcon, TrashIcon } from './icons'

/** How many versions of a preview Back and Forward can step through. */
const HISTORY = 10

interface Preview {
  /** Every version so far, oldest first, at most HISTORY. */
  history: ThemeSpec[]
  index: number
  /** What validation changed in the version on screen, if anything. */
  note: string | null
  /** The description it started from — saved with the theme. */
  prompt: string
}

const MODELS: Array<{ id: string; label: string }> = [
  { id: 'sonnet', label: 'Sonnet (balanced)' },
  { id: 'haiku', label: 'Haiku (fastest)' },
  { id: 'opus', label: 'Opus (most careful)' },
]

const SWATCHES: PaletteToken[] = ['bg-window', 'bg-panel', 'bg', 'text', 'accent', 'info', 'success']

const EFFECT_NAMES: Record<string, string> = {
  'digital-rain': 'Digital rain', 'perspective-grid': 'Perspective grid', 'starfield': 'Starfield',
  'noise': 'Noise', 'gradient-drift': 'Gradient drift', 'aurora': 'Aurora', 'scanlines': 'Scanlines',
  'crt-vignette': 'CRT vignette', 'neon-glow': 'Neon glow', 'glitch-flicker': 'Glitch', 'paper-grain': 'Paper grain',
}

function Swatches({ spec }: { spec: ThemeSpec }): JSX.Element {
  return (
    <span className="theme-swatches" aria-hidden="true">
      {SWATCHES.map((t) => (
        // A colour Apiary itself re-serialised (see validate.ts), set as a style value — the one
        // place a theme's colour is used outside a custom property.
        <span key={t} className="theme-swatch" style={{ background: spec.palette[t] ?? DEFAULT_PALETTE[t] }} />
      ))}
    </span>
  )
}

function effectsLabel(spec: ThemeSpec): string {
  const parts = spec.effects.map((e) => EFFECT_NAMES[e.kind] ?? e.kind)
  if (spec.material.kind === 'glass') parts.unshift(spec.material.refraction > 0 ? 'Liquid glass' : 'Frosted glass')
  return parts.length === 0 ? 'No effects' : parts.join(' · ')
}

/**
 * Settings → Themes: what is applied, every theme there is, and the effects options.
 *
 * Every change goes to main and comes back as the broadcast `useThemeState` listens for, so this
 * screen, every window's look, and themes.json can never disagree about what is active.
 */
export function ThemesSection(): JSX.Element {
  const theme = useThemeState()
  const { notifyError } = useNotifications()
  const [naming, setNaming] = useState<null | 'save' | 'rename' | 'save-preview'>(null)
  const [name, setName] = useState('')
  const [request, setRequest] = useState('')
  const [refine, setRefine] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const shown = preview === null ? null : preview.history[preview.index]

  /**
   * A preview is this window's alone, and only while this screen is open: leaving it — closing
   * Settings, or switching section — puts back what is really active. A broadcast from main
   * (another window changed a setting) re-applies the active theme through the hook, so the
   * preview is put back on top of it.
   */
  const activeRef = useRef(theme.active)
  activeRef.current = theme.active
  const previewingRef = useRef(false)
  previewingRef.current = preview !== null
  useEffect(() => () => { if (previewingRef.current) applyTheme(activeRef.current) }, [])
  useEffect(() => { if (shown !== null) applyTheme(shown) }, [shown, theme])

  const generate = (text: string, base: ThemeSpec | null): void => {
    setBusy(true)
    setError(null)
    window.apiary.themeGenerate(text, base).then(({ spec, note }) => {
      setPreview((prev) => {
        const kept = prev === null ? [] : prev.history.slice(0, prev.index + 1)
        const history = [...kept, spec].slice(-HISTORY)
        return { history, index: history.length - 1, note, prompt: prev?.prompt ?? text }
      })
      setRefine('')
    }).catch((e: unknown) => {
      // The IPC wrapper prefixes its own text; the part after the last colon-space is Claude's.
      const message = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
      setError(message)
    }).finally(() => { setBusy(false) })
  }
  const endPreview = (): void => {
    setPreview(null)
    applyTheme(theme.active)
  }

  const all: Array<{ id: string | null; spec: ThemeSpec; saved: boolean }> = [
    { id: null, spec: ORIGINAL_THEME, saved: false },
    ...theme.builtins.map((b) => ({ id: b.id, spec: b.spec, saved: false })),
    ...theme.saved.map((s) => ({ id: s.id, spec: { ...s.spec, name: s.name }, saved: true })),
  ]
  const current = all.find((t) => t.id === theme.activeId) ?? all[0]
  const run = (p: Promise<unknown>, what: string): void => { void p.catch((e: unknown) => { notifyError(e, what) }) }

  const submitName = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    if (naming === 'save-preview' && shown !== null && preview !== null) {
      run(window.apiary.themeSave(trimmed, shown, preview.prompt).then((saved) => {
        setPreview(null)
        return window.apiary.themeApply(saved.id)
      }), 'Could not save the theme')
    } else if (naming === 'save') {
      run(window.apiary.themeSave(trimmed, current.spec).then((saved) => window.apiary.themeApply(saved.id)), 'Could not save the theme')
    } else if (naming === 'rename' && current.id !== null) {
      run(window.apiary.themeRename(current.id, trimmed), 'Could not rename the theme')
    }
    setNaming(null)
  }

  return (
    <div className="themes-section" data-testid="themes-section">
      {theme.safeMode && (
        <p className="settings-help" data-testid="theme-safe-mode">
          Started with --safe-theme: showing the original look for this run. Your theme choice below is kept.
        </p>
      )}

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
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && request.trim() !== '' && !busy) { e.preventDefault(); setPreview(null); generate(request, null) }
          }}
        />
        <div className="theme-actions">
          {busy ? (
            <>
              <span className="theme-busy" data-testid="theme-generating"><span className="spinner-dot" /> Claude is designing — usually under a minute…</span>
              <button className="btn small" data-testid="theme-generate-cancel" onClick={() => window.apiary.themeGenerateCancel()}>Cancel</button>
            </>
          ) : (
            <button
              className="btn primary small"
              data-testid="theme-generate"
              disabled={request.trim() === ''}
              onClick={() => { setPreview(null); generate(request, null) }}
            >
              Generate
            </button>
          )}
        </div>
        {error !== null && <p className="theme-error" data-testid="theme-generate-error">{error}</p>}
      </div>

      {preview !== null && shown !== null && (
        <div className="theme-preview-bar" data-testid="theme-preview-bar">
          <div className="theme-current-head">
            <span><span className="settings-help">Previewing</span> <strong data-testid="theme-preview-name">{shown.name}</strong></span>
            <Swatches spec={shown} />
          </div>
          <span className="settings-help">{effectsLabel(shown)}</span>
          {preview.note !== null && <span className="settings-help theme-note" data-testid="theme-preview-note">{preview.note}</span>}
          <form className="theme-name-form" onSubmit={(e) => { e.preventDefault(); if (refine.trim() !== '' && !busy) generate(refine, shown) }}>
            <input
              className="search"
              data-testid="theme-refine"
              value={refine}
              disabled={busy}
              maxLength={2000}
              placeholder="Adjust it — more green, less glow, rounder corners"
              onChange={(e) => setRefine(e.target.value)}
            />
            <button type="submit" className="btn small" data-testid="theme-refine-submit" disabled={busy || refine.trim() === ''}>Refine</button>
          </form>
          <div className="theme-actions">
            <button
              className="btn small"
              data-testid="theme-history-back"
              disabled={busy || preview.index === 0}
              title="The previous version"
              onClick={() => setPreview({ ...preview, index: preview.index - 1, note: null })}
            >
              ◀
            </button>
            <button
              className="btn small"
              data-testid="theme-history-forward"
              disabled={busy || preview.index === preview.history.length - 1}
              title="The next version"
              onClick={() => setPreview({ ...preview, index: preview.index + 1, note: null })}
            >
              ▶
            </button>
            <span className="theme-actions-spacer" />
            <button
              className="btn primary small"
              data-testid="theme-keep"
              disabled={busy}
              onClick={() => {
                run(window.apiary.themeSave(shown.name, shown, preview.prompt).then((saved) => {
                  setPreview(null)
                  return window.apiary.themeApply(saved.id)
                }), 'Could not keep the theme')
              }}
            >
              Keep
            </button>
            <button className="btn small" data-testid="theme-preview-save-as" disabled={busy} onClick={() => { setName(shown.name); setNaming('save-preview') }}>
              Save as…
            </button>
            <button className="btn small" data-testid="theme-discard" disabled={busy} onClick={endPreview}>Discard</button>
          </div>
        </div>
      )}

      <div className="theme-current" data-testid="theme-current">
        <div className="theme-current-head">
          <strong data-testid="theme-current-name">{current.spec.name}</strong>
          <Swatches spec={current.spec} />
        </div>
        <span className="settings-help">{effectsLabel(current.spec)}</span>
        {naming !== null ? (
          <form className="theme-name-form" onSubmit={(e) => { e.preventDefault(); submitName() }}>
            <input
              autoFocus
              className="search"
              data-testid="theme-save-name"
              value={name}
              maxLength={60}
              placeholder="Theme name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null) }}
            />
            <button type="submit" className="btn primary small" data-testid="theme-save-confirm">
              {naming === 'rename' ? 'Rename' : 'Save'}
            </button>
            <button type="button" className="btn small" onClick={() => setNaming(null)}>Cancel</button>
          </form>
        ) : (
          <div className="theme-actions">
            <button
              className="btn small"
              data-testid="theme-reset"
              disabled={theme.activeId === null}
              onClick={() => run(window.apiary.themeApply(null), 'Could not reset the theme')}
            >
              Reset to original
            </button>
            <button
              className="btn small"
              data-testid="theme-save-as"
              disabled={current.id === null}
              title={current.id === null ? 'The original look is always here; there is nothing to copy' : 'Save a copy under a new name'}
              onClick={() => { setName(`${current.spec.name} copy`); setNaming('save') }}
            >
              Save as…
            </button>
            {current.saved && (
              <button className="btn small" data-testid="theme-rename" onClick={() => { setName(current.spec.name); setNaming('rename') }}>
                Rename
              </button>
            )}
          </div>
        )}
      </div>

      <div className="theme-grid" role="list">
        {all.map((t) => (
          <div key={t.id ?? 'original'} className="theme-card-wrap" role="listitem">
            <button
              className="theme-card"
              data-testid="theme-card"
              data-theme-id={t.id ?? 'original'}
              data-active={t.id === theme.activeId}
              onClick={() => run(window.apiary.themeApply(t.id), 'Could not apply the theme')}
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
                    run(window.apiary.themeApply(t.id).then(() => { setName(t.spec.name); setNaming('rename') }), 'Could not select the theme')
                  }}
                >
                  <PencilIcon />
                </button>
                <button
                  className="icon-button theme-card-action"
                  data-testid="theme-delete"
                  aria-label={`Delete ${t.spec.name}`}
                  title="Delete"
                  onClick={() => { if (t.id !== null) run(window.apiary.themeDelete(t.id), 'Could not delete the theme') }}
                >
                  <TrashIcon />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      <label className="settings-row theme-intensity">
        <span>
          <strong>Designed by</strong>
          <span className="settings-help">The Claude model your own claude uses to design themes.</span>
        </span>
        <select
          className="theme-model"
          data-testid="theme-model"
          value={theme.options.model}
          onChange={(e) => run(window.apiary.themeSetOptions({ model: e.target.value }), 'Could not change the setting')}
        >
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label className="settings-row">
        <input
          type="checkbox"
          data-testid="theme-animated"
          checked={theme.options.animated}
          onChange={(e) => run(window.apiary.themeSetOptions({ animated: e.target.checked }), 'Could not change the setting')}
        />
        <span>
          <strong>Animated effects</strong>
          <span className="settings-help">
            Off shows each effect as a still picture. Effects never move when your system asks for
            reduced motion, whatever this says.
          </span>
        </span>
      </label>
      <label className="settings-row theme-intensity">
        <span>
          <strong>Effect intensity</strong>
          <span className="settings-help">Tones every effect down without changing the theme.</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          data-testid="theme-intensity"
          value={Math.round(theme.options.intensity * 100)}
          onChange={(e) => run(window.apiary.themeSetOptions({ intensity: Number(e.target.value) / 100 }), 'Could not change the setting')}
        />
      </label>
      <p className="settings-help">
        If a theme ever makes Apiary hard to use, View → Reset Theme (Cmd/Ctrl+Alt+Shift+T) always
        brings back the original look.
      </p>
    </div>
  )
}
