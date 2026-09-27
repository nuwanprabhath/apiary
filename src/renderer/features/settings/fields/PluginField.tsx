import type { JSX } from 'react'
import type { PluginSettingFieldPayload } from '@shared/api'

/**
 * One plugin setting, drawn from what the plugin declared.
 *
 * Everything about the Plugins section is generic: a plugin that adds a field gets a working,
 * consistent control here without the dialog knowing what the field means. Adding a new *kind* of
 * field is the only thing that touches this file.
 */
export function PluginField(
  { pluginId, field, value, onChange }: {
    pluginId: string
    field: PluginSettingFieldPayload
    value: string | number | boolean
    onChange: (value: string | number | boolean) => void
  },
): JSX.Element {
  const testId = `plugin-setting-${pluginId}-${field.key}`

  if (field.kind === 'boolean') {
    return (
      <label className="settings-row settings-row-indent">
        <input
          type="checkbox"
          data-testid={testId}
          checked={typeof value === 'boolean' ? value : field.default}
          onChange={(e) => { onChange(e.target.checked) }}
        />
        <span>
          <strong>{field.label}</strong>
          {field.help !== undefined && <span className="settings-help">{field.help}</span>}
        </span>
      </label>
    )
  }

  return (
    <div className="settings-row settings-row-indent settings-plugin-field">
      <label className="settings-field-label" htmlFor={testId}>{field.label}</label>
      <input
        id={testId}
        className="search"
        data-testid={testId}
        type={field.kind === 'number' ? 'number' : 'text'}
        min={field.kind === 'number' ? field.min : undefined}
        max={field.kind === 'number' ? field.max : undefined}
        placeholder={field.kind === 'string' ? field.placeholder : undefined}
        value={String(value)}
        onChange={(e) => {
          if (field.kind === 'number') {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? n : field.default)
          } else {
            onChange(e.target.value)
          }
        }}
      />
      {field.help !== undefined && <span className="settings-help">{field.help}</span>}
    </div>
  )
}
