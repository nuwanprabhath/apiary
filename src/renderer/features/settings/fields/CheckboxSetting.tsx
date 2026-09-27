import type { JSX, ReactNode } from 'react'

/**
 * The checkbox-row markup repeated throughout SettingsDialog (UI-20): a checkbox, a bold label
 * and a help sentence underneath. `dataDisabled` is separate from `disabled` because exactly one
 * caller (the terminal section's "shorten the path" row) puts a `data-disabled` attribute on the
 * row itself for CSS to dim it, and every other row has no such attribute at all — passing
 * `undefined` here (the default) omits it exactly as the rows that never set it always have.
 */
export function CheckboxSetting(
  { testId, label, help, checked, onChange, disabled, dataDisabled }: {
    testId: string
    label: ReactNode
    help: ReactNode
    checked: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
    dataDisabled?: boolean
  },
): JSX.Element {
  return (
    <label className="settings-row" data-disabled={dataDisabled}>
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.checked) }}
      />
      <span>
        <strong>{label}</strong>
        <span className="settings-help">{help}</span>
      </span>
    </label>
  )
}
