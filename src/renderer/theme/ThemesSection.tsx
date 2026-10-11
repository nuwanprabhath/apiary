import { type JSX, useEffect, useRef, useState } from 'react'
import { ORIGINAL_THEME, type ThemeSpec } from '@shared/theme/spec'
import { useThemeState } from './useTheme'
import { applyTheme } from './applyTheme'
import { describeError } from '../ui/errors'
import { ThemeCurrent, type Naming } from './ThemeCurrent'
import { ThemeDescribe } from './ThemeDescribe'
import { ThemeGrid, type ThemeEntry } from './ThemeGrid'
import { ThemeOptionsRows } from './ThemeOptionsRows'
import { ThemePreviewBar, type Preview } from './ThemePreviewBar'
import { activateTheme, generateTheme, renameTheme, saveTheme } from '../state/theme'
import { surface } from '../state/policy'

/** How many versions of a preview Back and Forward can step through. */
const HISTORY = 10

/**
 * Settings → Themes: what is applied, every theme there is, and the effects options.
 *
 * Every change goes to main and comes back as the broadcast `useThemeState` listens for, so this
 * screen, every window's look, and themes.json can never disagree about what is active.
 */
export function ThemesSection(): JSX.Element {
  const theme = useThemeState()
  const [naming, setNaming] = useState<Naming>(null)
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
    generateTheme(text, base).then(({ spec, note }) => {
      setPreview((prev) => {
        const kept = prev === null ? [] : prev.history.slice(0, prev.index + 1)
        const history = [...kept, spec].slice(-HISTORY)
        return { history, index: history.length - 1, note, prompt: prev?.prompt ?? text }
      })
      setRefine('')
    }).catch((e: unknown) => {
      setError(describeError(e).message)
    }).finally(() => { setBusy(false) })
  }
  const endPreview = (): void => {
    setPreview(null)
    applyTheme(theme.active)
  }

  const all: ThemeEntry[] = [
    { id: null, spec: ORIGINAL_THEME, saved: false },
    ...theme.builtins.map((b) => ({ id: b.id, spec: b.spec, saved: false })),
    ...theme.saved.map((s) => ({ id: s.id, spec: { ...s.spec, name: s.name }, saved: true })),
  ]
  const current = all.find((t) => t.id === theme.activeId) ?? all[0]

  const submitName = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    if (naming === 'save-preview' && shown !== null && preview !== null) {
      surface(saveTheme(trimmed, shown, preview.prompt).then((saved) => {
        setPreview(null)
        return activateTheme(saved.id)
      }), 'Could not save the theme')
    } else if (naming === 'save') {
      surface(saveTheme(trimmed, current.spec).then((saved) => activateTheme(saved.id)), 'Could not save the theme')
    } else if (naming === 'rename' && current.id !== null) {
      surface(renameTheme(current.id, trimmed), 'Could not rename the theme')
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

      <ThemeDescribe
        request={request}
        busy={busy}
        error={error}
        onRequest={setRequest}
        onGenerate={() => { setPreview(null); generate(request, null) }}
      />

      {preview !== null && shown !== null && (
        <ThemePreviewBar
          preview={preview}
          shown={shown}
          refine={refine}
          busy={busy}
          onRefine={setRefine}
          onRefineSubmit={() => { generate(refine, shown) }}
          onStep={setPreview}
          onKept={() => { setPreview(null) }}
          onSaveAs={() => { setName(shown.name); setNaming('save-preview') }}
          onDiscard={endPreview}
        />
      )}

      <ThemeCurrent
        current={current}
        activeId={theme.activeId}
        naming={naming}
        name={name}
        onName={setName}
        onSubmitName={submitName}
        onStartNaming={(kind, initial) => { setName(initial); setNaming(kind) }}
        onCancelNaming={() => { setNaming(null) }}
      />

      <ThemeGrid
        all={all}
        activeId={theme.activeId}
        onRename={(spec) => { setName(spec.name); setNaming('rename') }}
      />

      <ThemeOptionsRows options={theme.options} />
      <p className="settings-help">
        If a theme ever makes Apiary hard to use, View → Reset Theme (Cmd/Ctrl+Alt+Shift+T) always
        brings back the original look.
      </p>
    </div>
  )
}
