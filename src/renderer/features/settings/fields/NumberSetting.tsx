import type { JSX } from 'react'

/**
 * The number-with-clamp pattern repeated 6 times across SettingsDialog (UI-20): a typed value
 * below `min` or not a number at all falls back to `min` rather than being left invalid, and a
 * typed value above `max` is capped rather than accepted.
 */
export function clampInt(raw: string, min: number, max: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= min ? Math.min(max, Math.round(n)) : min
}

export interface NumberPreset {
  value: number
  testId: string
  label: string
}

/**
 * One "Every N units" row, with optional preset buttons. Deliberately renders only the
 * `<label className="settings-inline">` plus an optional presets row — not the surrounding
 * `settings-row settings-row-indent` div — since some callers (the terminal path preview) put
 * another sibling inside that same wrapping div, and it stays owned by the section.
 */
export function NumberSetting(
  { testId, label, unit, min, max, value, onChange, presets }: {
    testId: string
    label: string
    unit: string
    min: number
    max: number
    value: number
    onChange: (value: number) => void
    presets?: NumberPreset[]
  },
): JSX.Element {
  return (
    <>
      <label className="settings-inline">
        <span>{label}</span>
        <input
          className="search settings-number"
          type="number"
          min={min}
          max={max}
          data-testid={testId}
          value={value}
          onChange={(e) => { onChange(clampInt(e.target.value, min, max)) }}
        />
        <span>{unit}</span>
      </label>
      {presets !== undefined && (
        <div className="settings-presets">
          {presets.map((p) => (
            <button
              key={p.value}
              className="settings-preset"
              data-testid={p.testId}
              data-active={value === p.value}
              onClick={() => { onChange(p.value) }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
