import { type JSX, useState } from 'react'
import type { AppSettingsPayload, UpdateStatusPayload } from '@shared/api'
import { SETTINGS } from '@shared/settings/schema'
import { formatVersion, formatChecked, describeCheck } from '../../update/updateSummary'
import { CheckboxSetting } from '../fields/CheckboxSetting'
import { NumberSetting } from '../fields/NumberSetting'
import { checkForUpdate } from '../../../state/updateStore'
import { describeError } from '../../../ui/errors'

/** Check-interval presets, in hours. */
const UPDATE_INTERVAL_PRESETS = [1, 6, 12, 24]

/**
 * `update` comes from App, which already holds the one shared `useUpdate()` subscription the
 * banner reads — this section used to open a second one of its own (UI-20), which is the bug
 * `useUpdate.ts`'s own comment ("One subscription, shared by the banner and the Settings panel")
 * describes but the old code did not actually honour.
 */
export function UpdatesSection(
  { draft, patch, update }: {
    draft: AppSettingsPayload
    patch: (fields: Partial<AppSettingsPayload>) => void
    update: UpdateStatusPayload | null
  },
): JSX.Element {
  /** Set while a check the user pressed for is running, so the button can say so. */
  const [checking, setChecking] = useState(false)
  /** What the last check the user pressed for came back with, said next to the button. */
  const [checkResult, setCheckResult] = useState<string | null>(null)

  /** False where this build has no updater to ask — a dev run, or a platform without one. */
  const canCheck = update !== null && update.capability.kind !== 'unsupported'

  return (
    <>
      <div className="settings-row" data-testid="update-version-row">
        <span className="settings-help">
          <strong>Version {update === null ? '—' : formatVersion(update.currentVersion)}</strong>
          <br />
          Last checked: {formatChecked(update?.lastCheckedAt ?? null)}
          {update !== null && update.capability.kind !== 'auto' && (
            <>
              <br />
              {update.capability.reason}
            </>
          )}
          {update?.skippedVersion !== null && update?.skippedVersion !== undefined && (
            <>
              <br />
              Skipping {formatVersion(update.skippedVersion)}. A newer release than that
              is still offered.
            </>
          )}
        </span>
        <div className="settings-inline settings-check">
          {checkResult !== null && (
            <span className="settings-help" data-testid="update-check-result">{checkResult}</span>
          )}
          <button
            className="btn"
            data-testid="update-check-now"
            // A check that cannot run is not offered. On a build with no updater at all
            // the press used to be swallowed silently, which is indistinguishable from
            // a broken button — the reason is already spelled out above.
            disabled={
              canCheck === false
              || checking || update?.phase === 'checking' || update?.phase === 'downloading'
            }
            title={canCheck === false ? update?.capability.reason : undefined}
            onClick={() => {
              setChecking(true)
              setCheckResult(null)
              // The answer comes from what this call resolves with, not from the pushed
              // status: see describeCheck for why the push is not enough here.
              void checkForUpdate()
                .then((status) => { setCheckResult(describeCheck(status)) })
                .catch((e: unknown) => {
                  setCheckResult(`Could not check — ${describeError(e).message}`)
                })
                .finally(() => { setChecking(false) })
            }}
          >
            {checking || update?.phase === 'checking' ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      <CheckboxSetting
        testId="setting-update-automatic"
        checked={draft.updateAutomaticChecks}
        onChange={(checked) => { patch({ updateAutomaticChecks: checked }) }}
        label="Check for updates automatically"
        help={(
          <>
            Apiary asks GitHub whether there is a newer release, and tells you if there
            is. Nothing is downloaded or installed without you saying so.
          </>
        )}
      />

      {draft.updateAutomaticChecks && (
        <div className="settings-row settings-row-indent">
          <NumberSetting
            testId="setting-update-interval"
            label="Every"
            unit="hours"
            min={SETTINGS.updateCheckIntervalHours.range.min}
            max={SETTINGS.updateCheckIntervalHours.range.max}
            value={draft.updateCheckIntervalHours}
            onChange={(n) => { patch({ updateCheckIntervalHours: n }) }}
            presets={UPDATE_INTERVAL_PRESETS.map((hrs) => ({
              value: hrs, testId: `setting-update-preset-${String(hrs)}`, label: `${String(hrs)}h`,
            }))}
          />
        </div>
      )}

      <CheckboxSetting
        testId="setting-update-auto-download"
        checked={draft.updateAutoDownload}
        onChange={(checked) => { patch({ updateAutoDownload: checked }) }}
        label="Download updates as soon as they are found"
        help={update?.capability.kind === 'assisted'
          ? 'The installer is fetched in the background and opened when it is ready, '
            + 'instead of waiting for you to press Download.'
          : 'The update is fetched in the background, so installing it is just a '
            + 'restart. Nothing restarts on its own.'}
      />

      <CheckboxSetting
        testId="setting-update-prerelease"
        checked={draft.updateAllowPrerelease}
        onChange={(checked) => { patch({ updateAllowPrerelease: checked }) }}
        label="Include pre-release versions"
        help="Offers beta builds as well as finished releases. Off unless you want to test what is coming next."
      />
    </>
  )
}
