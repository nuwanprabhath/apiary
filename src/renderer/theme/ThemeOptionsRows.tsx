import type { JSX } from 'react'
import { THEME_MODELS, type ThemeModel } from '@shared/theme/models'
import { THEME_MODEL_LABELS } from '../ui/modelLabels'
import { setThemeOptions } from '../state/theme'
import { surface } from '../state/policy'

const MODELS: Array<{ id: ThemeModel; label: string }> =
  THEME_MODELS.map((id) => ({ id, label: THEME_MODEL_LABELS[id] }))

interface Props {
  options: { model: ThemeModel; animated: boolean; intensity: number }
}

/** The model that designs themes, and the effects options (animation, intensity). */
export function ThemeOptionsRows({ options }: Props): JSX.Element {
  return (
    <>
      <label className="settings-row theme-intensity">
        <span>
          <strong>Designed by</strong>
          <span className="settings-help">The Claude model your own claude uses to design themes.</span>
        </span>
        <select
          className="theme-model"
          data-testid="theme-model"
          value={options.model}
          onChange={(e) => { surface(setThemeOptions({ model: e.target.value as ThemeModel }), 'Could not change the setting') }}
        >
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label className="settings-row">
        <input
          type="checkbox"
          data-testid="theme-animated"
          checked={options.animated}
          onChange={(e) => { surface(setThemeOptions({ animated: e.target.checked }), 'Could not change the setting') }}
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
          value={Math.round(options.intensity * 100)}
          onChange={(e) => { surface(setThemeOptions({ intensity: Number(e.target.value) / 100 }), 'Could not change the setting') }}
        />
      </label>
    </>
  )
}
