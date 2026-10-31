import { type JSX, useEffect, useState } from 'react'
import { CHAT_PERMISSION_MODES, CHAT_PERMISSION_MODE_LABELS } from '@shared/domain/chat'
import {
  CYCLE_ACTION_ID, CYCLE_MINUTES, type DigestLookback, type ResidentConfig, type ResidentCycle, type ResidentOptionField,
} from '@shared/domain/residents'
import { clockText, dayClock } from '@shared/residentSchedule'
import { runQuickAction } from '../../../state/residentChat'
import { pickResidentFolder } from '../../../state/residentSettings'
import { useAppSettings } from '../../../state/settingsStore'
import { BusyGlyph } from '../../../ui/BusyGlyph'
import { describeError } from '../../../ui/errors'

type Save = (patch: Partial<ResidentConfig>) => void

const MAX_AMOUNT = 999
const UNITS: DigestLookback['unit'][] = ['days', 'weeks', 'months']
const LOOKBACK_PRESETS: [string, string, DigestLookback | null][] = [
  ['1w', '1 week', { amount: 1, unit: 'weeks' }],
  ['2w', '2 weeks', { amount: 2, unit: 'weeks' }],
  ['1m', '1 month', { amount: 1, unit: 'months' }],
  ['3m', '3 months', { amount: 3, unit: 'months' }],
  ['6m', '6 months', { amount: 6, unit: 'months' }],
  ['1y', '1 year', { amount: 12, unit: 'months' }],
  ['all', 'All history', null],
]
const CUSTOM = 'custom'

function presetOf(value: DigestLookback | null): string {
  const match = LOOKBACK_PRESETS.find(([, , p]) => (p === null ? value === null : value !== null && p.amount === value.amount && p.unit === value.unit))
  return match?.[0] ?? CUSTOM
}

/** What its claude may do without asking, as chat mode offers. */
export function PermissionModeSelect({ config, save }: { config: ResidentConfig; save: Save }): JSX.Element {
  return (
    <select
      className="theme-model"
      data-testid={`resident-permission-mode-${config.id}`}
      aria-label="Permissions"
      value={config.permissionMode}
      onChange={(e) => {
        const mode = CHAT_PERMISSION_MODES.find((m) => m === e.target.value)
        if (mode !== undefined) save({ permissionMode: mode })
      }}
    >
      {CHAT_PERMISSION_MODES.map((m) => <option key={m} value={m}>{CHAT_PERMISSION_MODE_LABELS[m]}</option>)}
    </select>
  )
}

/**
 * How often a kind with a cycle runs it (5 to 60 minutes; the kind's own interval until chosen),
 * when the next one is, and Check now, which runs one through the quick-action path.
 */
export function CycleField({ config, defaultMinutes, cycle, save }: {
  config: ResidentConfig
  defaultMinutes: number
  cycle: ResidentCycle | null
  save: Save
}): JSX.Element {
  // Read when the next time changes, not on every render.
  const nextAt = cycle?.nextAt ?? null
  const { busyAnimation, busyAnimationColor } = useAppSettings()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { setNow(new Date()) }, [nextAt])
  let next: string | null = null
  if (nextAt !== null) {
    const at = new Date(nextAt)
    const when = clockText(at, now)
    next = when === dayClock(at) ? `Next check ${when}` : `Next check at ${when}`
  }
  return (
    <div className="resident-cycle">
      <div className="resident-cycle-row">
        <select
          className="theme-model"
          data-testid={`resident-cycle-${config.id}`}
          aria-label="Check every"
          value={config.cycleEveryMinutes ?? defaultMinutes}
          onChange={(e) => {
            const minutes = CYCLE_MINUTES.find((m) => String(m) === e.target.value)
            if (minutes !== undefined) save({ cycleEveryMinutes: minutes })
          }}
        >
          {CYCLE_MINUTES.map((m) => <option key={m} value={m}>{`${String(m)} minutes`}</option>)}
        </select>
        <button className="btn small resident-check-now" data-testid={`resident-check-now-${config.id}`} disabled={!config.enabled} onClick={() => { runQuickAction(config.id, CYCLE_ACTION_ID) }}>
          {cycle?.running === true && <BusyGlyph animation={busyAnimation} color={busyAnimationColor} />}
          {cycle?.running === true ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {cycle?.running === true
        ? <span className="muted" data-testid={`resident-next-check-${config.id}`}>Checking now</span>
        : next !== null && <span className="muted" data-testid={`resident-next-check-${config.id}`}>{next}</span>}
    </div>
  )
}

/** How far back the digest reaches: a preset, or Custom with an amount (1–999) and a unit. */
export function LookbackField({ config, save }: { config: ResidentConfig; save: Save }): JSX.Element {
  const stored = config.digestLookback
  const [custom, setCustom] = useState(() => presetOf(stored) === CUSTOM)
  const current = stored ?? { amount: 1, unit: 'months' }
  const [amount, setAmount] = useState(String(current.amount))
  useEffect(() => { setAmount(String(current.amount)) }, [current.amount])
  const commitAmount = (): void => {
    const n = Math.round(Number(amount))
    if (!Number.isFinite(n) || n < 1) { setAmount(String(current.amount)); return }
    const next = Math.min(MAX_AMOUNT, n)
    setAmount(String(next))
    if (stored === null || next !== stored.amount) save({ digestLookback: { amount: next, unit: current.unit } })
  }
  return (
    <div className="resident-lookback">
      <select
        className="theme-model"
        data-testid={`resident-lookback-${config.id}`}
        aria-label="Digest lookback"
        value={custom ? CUSTOM : presetOf(stored)}
        onChange={(e) => {
          if (e.target.value === CUSTOM) { setCustom(true); return }
          const preset = LOOKBACK_PRESETS.find(([key]) => key === e.target.value)
          if (preset === undefined) return
          setCustom(false)
          save({ digestLookback: preset[2] })
        }}
      >
        {LOOKBACK_PRESETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {custom && (
        <>
          <input
            className="search resident-lookback-amount"
            data-testid={`resident-lookback-amount-${config.id}`}
            aria-label="Amount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => { setAmount(e.target.value.replace(/\D/g, '')) }}
            onBlur={commitAmount}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
          <select
            className="theme-model"
            data-testid={`resident-lookback-unit-${config.id}`}
            aria-label="Unit"
            value={current.unit}
            onChange={(e) => {
              const unit = UNITS.find((u) => u === e.target.value)
              if (unit !== undefined) save({ digestLookback: { amount: current.amount, unit } })
            }}
          >
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </>
      )}
    </div>
  )
}

/** A text option, saved on blur or Enter. */
function TextOption({ config, field, save }: { config: ResidentConfig; field: ResidentOptionField; save: Save }): JSX.Element {
  const saved = config.options[field.key] ?? ''
  const [text, setText] = useState(saved)
  useEffect(() => { setText(saved) }, [saved])
  return (
    <input
      className="search"
      data-testid={`resident-option-${config.id}-${field.key}`}
      aria-label={field.label}
      value={text}
      onChange={(e) => { setText(e.target.value) }}
      onBlur={() => { const next = text.trim(); if (next !== saved) save({ options: { ...config.options, [field.key]: next } }) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

/** A folder option: the chosen path, read only, and Choose…, which asks main's folder dialog. */
function FolderOption({ config, field }: { config: ResidentConfig; field: ResidentOptionField }): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const path = config.options[field.key] ?? ''
  return (
    <>
      <div className="resident-folder">
        <span className="resident-folder-path" data-testid={`resident-option-${config.id}-${field.key}`} title={path}>
          <bdi>{path === '' ? 'None chosen' : path}</bdi>
        </span>
        <button
          type="button"
          className="btn small"
          data-testid={`resident-option-choose-${config.id}-${field.key}`}
          onClick={() => {
            setError(null)
            pickResidentFolder(config.id, field.key).catch((e: unknown) => { setError(describeError(e).message) })
          }}
        >
          Choose…
        </button>
      </div>
      {error !== null && <span className="settings-help remote-pairing-error" role="alert">{error}</span>}
    </>
  )
}

/** The kind's own settings, drawn from its `optionFields`. */
export function OptionFields({ config, fields, save }: { config: ResidentConfig; fields: readonly ResidentOptionField[]; save: Save }): JSX.Element {
  return (
    <>
      {fields.map((f) => (
        <div key={f.key} className="resident-field">
          <strong>
            {f.label}
            {f.required && (config.options[f.key] ?? '') === '' && <span className="resident-required" data-testid={`resident-required-${config.id}-${f.key}`}> Required</span>}
          </strong>
          {f.input === 'folder' ? <FolderOption config={config} field={f} /> : <TextOption config={config} field={f} save={save} />}
          {f.help !== '' && <span className="settings-help">{f.help}</span>}
        </div>
      ))}
    </>
  )
}
