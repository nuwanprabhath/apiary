import type { JSX } from 'react'
import type { AppSettingsPayload, PluginInfoPayload } from '@shared/api'
import { PluginField } from '../fields/PluginField'

/**
 * `plugins` is loaded once by the dialog shell, not by this section — see SearchSection's
 * comment for why sections that could own their async state still take it as a prop here: the
 * shell fetches it once on open, and scoping the fetch to this section's own mount would refetch
 * on every visit instead.
 */
export function PluginsSection(
  { draft, patch, plugins }: {
    draft: AppSettingsPayload
    patch: (fields: Partial<AppSettingsPayload>) => void
    plugins: PluginInfoPayload[]
  },
): JSX.Element {
  return (
    <>
      {plugins.map((plugin) => {
        const enabled = draft.plugins[plugin.id] ?? plugin.enabled
        const values = { ...plugin.values, ...draft.pluginSettings[plugin.id] }
        const setValue = (key: string, value: string | number | boolean): void => {
          patch({
            pluginSettings: {
              ...draft.pluginSettings,
              [plugin.id]: { ...values, [key]: value },
            },
          })
        }
        return (
          <div className="settings-plugin" key={plugin.id} data-testid={`plugin-${plugin.id}`}>
            <label className="settings-row">
              <input
                type="checkbox"
                data-testid={`setting-plugin-${plugin.id}`}
                checked={enabled}
                onChange={(e) => { patch({
                  plugins: { ...draft.plugins, [plugin.id]: e.target.checked },
                }) }}
              />
              <span>
                <strong>{plugin.name}</strong>
                {plugin.description !== null && (
                  <span className="settings-help">{plugin.description}</span>
                )}
              </span>
            </label>

            {/* A plugin's own settings sit under it, indented, and only while it is on:
                configuring something switched off is a question nobody asked. */}
            {enabled && plugin.fields.map((field) => (
              <PluginField
                key={field.key}
                pluginId={plugin.id}
                field={field}
                value={values[field.key] ?? field.default}
                onChange={(value) => { setValue(field.key, value) }}
              />
            ))}
          </div>
        )
      })}

      {plugins.length === 0 && <p className="empty">No plugins are installed.</p>}
    </>
  )
}
