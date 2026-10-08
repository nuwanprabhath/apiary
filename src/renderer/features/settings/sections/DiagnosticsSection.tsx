import { type JSX, useEffect, useState } from 'react'
import type { AppSettingsPayload, LogStatusPayload } from '@shared/api'
import { SETTINGS } from '@shared/settings/schema'
import { CheckboxSetting } from '../fields/CheckboxSetting'
import { clampInt } from '../fields/NumberSetting'
import { copyText } from '../../../state/clipboard'
import { readLogStatus } from '../../../state/log'
import { clearLogs, revealLogFolder } from '../../../state/diagnostics'
import { logBackgroundFailure } from '../../../ui/fireAndForget'

/** Log sizes, in the units a person would say them in. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * `logStatus` is owned here rather than by the dialog shell: the original code re-read it every
 * time this section became active (`[section, draft?.diagnosticsEnabled]`), which is exactly what
 * mounting/unmounting this component already does, so moving the effect here changes nothing.
 */
export function DiagnosticsSection(
  { draft, patch }: { draft: AppSettingsPayload; patch: (fields: Partial<AppSettingsPayload>) => void },
): JSX.Element {
  const [logStatus, setLogStatus] = useState<LogStatusPayload | null>(null)

  // Re-read whenever the switch is flipped: the folder does not exist until logging is on, so
  // "where the logs are" changes with the checkbox.
  useEffect(() => {
    readLogStatus().then(setLogStatus).catch((e: unknown) => {
      // The folder not being readable reads as "not written yet"; the cause is in the log.
      setLogStatus(null)
      logBackgroundFailure(e, 'app')
    })
  }, [draft.diagnosticsEnabled])

  return (
    <>
      <CheckboxSetting
        testId="setting-diagnostics-enabled"
        checked={draft.diagnosticsEnabled}
        onChange={(checked) => { patch({ diagnosticsEnabled: checked }) }}
        label="Write a diagnostic log"
        help={(
          <>
            Off by default, and off means nothing is written at all &mdash; no folder,
            no file. Switch it on when something is going wrong, reproduce it, then send
            the folder below on. Some bugs only happen on one machine, and without this
            there is nothing to read.
          </>
        )}
      />

      <div className="settings-row settings-row-indent">
        <span className="settings-help" data-testid="diagnostics-privacy">
          <strong>What goes in it.</strong> What Apiary did &mdash; which terminals it
          started, which git commands ran and how they ended, what the updater tried,
          which settings are on. <strong>Not</strong> your conversations: no prompts, no
          replies, no transcript text, ever. Paths have your home directory replaced
          with <code>~</code>, and anything shaped like a token or a password is
          stripped before it is written.
        </span>
      </div>

      {draft.diagnosticsEnabled && (
        <div className="settings-row settings-row-indent">
          <label className="settings-inline">
            <span>Keep logs for</span>
            <input
              className="search settings-number"
              type="number"
              min={SETTINGS.logRetentionDays.range.min}
              max={SETTINGS.logRetentionDays.range.max}
              data-testid="setting-log-retention-days"
              value={draft.logRetentionDays}
              onChange={(e) => {
                patch({ logRetentionDays: clampInt(e.target.value, SETTINGS.logRetentionDays.range.min, SETTINGS.logRetentionDays.range.max) })
              }}
            />
            <span>days, using at most</span>
            <input
              className="search settings-number"
              type="number"
              min={SETTINGS.logMaxSizeMb.range.min}
              max={SETTINGS.logMaxSizeMb.range.max}
              data-testid="setting-log-max-size"
              value={draft.logMaxSizeMb}
              onChange={(e) => {
                patch({ logMaxSizeMb: clampInt(e.target.value, SETTINGS.logMaxSizeMb.range.min, SETTINGS.logMaxSizeMb.range.max) })
              }}
            />
            <span>MB</span>
          </label>
          <span className="settings-help">
            Whichever limit is reached first. The size limit wins where they disagree:
            the oldest files go until the logs fit.
          </span>
        </div>
      )}

      <div className="settings-row settings-row-stacked">
        <strong>Where the logs are</strong>
        <code className="settings-path" data-testid="log-folder-path">
          {logStatus === null ? 'Not written yet' : logStatus.dir}
        </code>
        <span className="settings-help" data-testid="log-folder-size">
          {logStatus === null
            ? ''
            : logStatus.files === 0
              ? 'No log files yet.'
              : `${String(logStatus.files)} file${logStatus.files === 1 ? '' : 's'}, ${formatBytes(logStatus.bytes)}.`}
        </span>
        <div className="settings-inline">
          <button
            className="btn"
            data-testid="log-open-folder"
            onClick={() => {
              revealLogFolder()
            }}
          >
            Open log folder
          </button>
          <button
            className="btn"
            data-testid="log-copy-path"
            onClick={() => {
              void copyText(logStatus?.dir ?? '')
            }}
          >
            Copy path
          </button>
          <button
            className="btn danger"
            data-testid="log-clear"
            disabled={logStatus === null || logStatus.files === 0}
            onClick={() => {
              void clearLogs().then((status) => { if (status !== null) setLogStatus(status) })
            }}
          >
            Delete logs
          </button>
        </div>
      </div>
    </>
  )
}
