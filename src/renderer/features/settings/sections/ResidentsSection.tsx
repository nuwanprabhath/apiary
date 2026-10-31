import { type JSX, useEffect, useRef, useState } from 'react'
import { dutyStatusText } from '@shared/residentSchedule'
import type { ResidentConfig, ResidentKindInfo, ResidentStatus } from '@shared/domain/residents'
import { useAppSettings } from '../../../state/settingsStore'
import { useResidents } from '../../../state/residentsStore'
import {
  addResident, clearRevealedResidentCard, updateResident, useResidentKinds, useRevealedResidentCard,
} from '../../../state/residentSettings'
import { CycleField, LookbackField, OptionFields, PermissionModeSelect } from './ResidentCardFields'
import { clearResident, redigestResident } from '../../../state/residentChat'
import { openResidentPopup } from '../../../state/residentPopup'
import { describeError } from '../../../ui/errors'
import { ErrorBoundary } from '../../../ui/ErrorBoundary'
import { Modal } from '../../../ui/Modal'
import { Switch } from '../../../ui/Switch'

const MAX_NAME = 40
const WEEK = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]] as const
const RESIDENT_MODELS:[string, string][] = [
  ['default', 'Default'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku'], ['claude-fable-5-1', 'Fable'],
]
const DIGEST_MODELS: [string, string][] = [['haiku', 'Haiku (recommended)'], ['sonnet', 'Sonnet']]
const PAUSE_LEVELS: [number, string][] = [
  [0, 'Never'], [50, '50% of the 5-hour limit'], [60, '60% of the 5-hour limit'], [70, '70% of the 5-hour limit'],
  [80, '80% of the 5-hour limit'], [90, '90% of the 5-hour limit'],
]
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`)

type Confirming = { kind: 'clear' | 'redigest'; id: string; name: string }

/** The preset options, plus the stored value as its own option when it is not one of them. */
function Options<T extends string | number>({ choices, value }: { choices: [T, string][]; value: T }): JSX.Element {
  return (
    <>
      {choices.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      {!choices.some(([v]) => v === value) && <option value={value}>{String(value)}</option>}
    </>
  )
}

function ConfirmDialog({ confirming, onCancel, onOk }: { confirming: Confirming; onCancel: () => void; onOk: () => void }): JSX.Element {
  const clear = confirming.kind === 'clear'
  return (
    <ErrorBoundary label="This dialog">
      <Modal
        testId="resident-confirm-dialog"
        titleId="resident-confirm-title"
        onClose={onCancel}
        initialFocusSelector='[data-testid="resident-confirm-cancel"]'
      >
        <h2 id="resident-confirm-title">{clear ? `Clear ${confirming.name}'s chat history?` : `Re-digest everything for ${confirming.name}?`}</h2>
        <p>
          {clear
            ? 'The conversation is deleted from this Mac. Your sessions are untouched.'
            : 'Every session is read again and summarised, which uses Claude quota and can take a while.'}
        </p>
        <div className="modal-actions">
          <button className="btn" data-testid="resident-confirm-cancel" onClick={onCancel}>Cancel</button>
          <button className={`btn ${clear ? 'danger' : 'primary'}`} data-testid="resident-confirm-ok" onClick={onOk}>
            {clear ? 'Clear history' : 'Re-digest'}
          </button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}

/** A name saved on blur or Enter; an empty one goes back to the saved name. */
function NameField({ config, save }: { config: ResidentConfig; save: (patch: Partial<ResidentConfig>) => void }): JSX.Element {
  const [text, setText] = useState(config.name)
  useEffect(() => { setText(config.name) }, [config.name])
  const commit = (): void => {
    const next = text.trim()
    if (next === '') { setText(config.name); return }
    if (next !== config.name) save({ name: next })
  }
  return (
    <input
      className="search"
      data-testid={`resident-name-${config.id}`}
      aria-label="Name"
      maxLength={MAX_NAME}
      value={text}
      onChange={(e) => { setText(e.target.value) }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

function HoursRow({ config, save }: { config: ResidentConfig; save: (patch: Partial<ResidentConfig>) => void }): JSX.Element {
  const { start, end } = config.schedule
  const hours = (key: 'start' | 'end', label: string, value: string): JSX.Element => (
    <label className="resident-hour">
      <span className="muted">{label}</span>
      <select
        className="theme-model"
        data-testid={`resident-${key}-${config.id}`}
        value={value}
        onChange={(e) => { save({ schedule: { ...config.schedule, [key]: e.target.value } }) }}
      >
        <Options choices={HALF_HOURS.map((h): [string, string] => [h, h])} value={value} />
      </select>
    </label>
  )
  return (
    <div className="resident-hours">
      {hours('start', 'From', start)}
      {hours('end', 'To', end)}
      {end <= start && <span className="muted" data-testid={`resident-overnight-${config.id}`}>(overnight)</span>}
    </div>
  )
}

function DigestLine({ id, digest }: { id: string; digest: ResidentStatus['digest'] }): JSX.Element {
  const started = digest !== null && digest.total > 0 && digest.done > 0
  return (
    <div className="resident-digest" data-testid={`resident-digest-${id}`}>
      <span className="muted">
        {started ? `Digested ${digest.done} of ${digest.total} sessions` : 'Not started yet'}
      </span>
      {started && (
        <div className="resident-progress" role="progressbar" aria-valuemin={0} aria-valuemax={digest.total} aria-valuenow={digest.done}>
          <div className="resident-progress-fill" style={{ width: `${String(Math.min(100, (digest.done / digest.total) * 100))}%` }} />
        </div>
      )}
    </div>
  )
}

const REVEAL_MS = 1600

/** Scrolls the card into view and highlights it briefly when the badge's "Settings…" asked for it. */
function useReveal(id: string): { ref: React.RefObject<HTMLElement | null>; revealed: boolean } {
  const ref = useRef<HTMLElement | null>(null)
  const asked = useRevealedResidentCard() === id
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (!asked) return
    clearRevealedResidentCard()
    ref.current?.scrollIntoView({ block: 'nearest' })
    setRevealed(true)
  }, [asked])
  useEffect(() => {
    if (!revealed) return
    const timer = window.setTimeout(() => { setRevealed(false) }, REVEAL_MS)
    return () => { window.clearTimeout(timer) }
  }, [revealed])
  return { ref, revealed }
}

function ResidentCard(
  { config, kind, status, onConfirm }: { config: ResidentConfig; kind: ResidentKindInfo | undefined; status: ResidentStatus | undefined; onConfirm: (c: Confirming) => void },
): JSX.Element {
  const { ref, revealed } = useReveal(config.id)
  // Until the kinds arrive, a card is drawn as one that digests, as Regent (the only one before kinds) does.
  const digests = kind?.digests ?? true
  const [error, setError] = useState<string | null>(null)
  const save = (patch: Partial<ResidentConfig>): void => {
    setError(null)
    updateResident(config.id, patch).catch((e: unknown) => { setError(describeError(e).message) })
  }
  const field = (label: string, control: JSX.Element, help?: string): JSX.Element => (
    <div className="resident-field">
      <strong>{label}</strong>
      {control}
      {help !== undefined && <span className="settings-help">{help}</span>}
    </div>
  )
  const { days } = config.schedule
  // The text depends on the clock; it is re-read when the schedule or the duty state changes.
  const [now, setNow] = useState(() => new Date())
  const onDuty = status?.onDuty
  useEffect(() => { setNow(new Date()) }, [config.schedule, onDuty])
  return (
    <section className="resident-card" data-testid={`resident-card-${config.id}`} data-revealed={revealed} ref={ref}>
      {field('Name', <NameField config={config} save={save} />)}
      <div className="resident-field resident-enabled">
        <strong>Enabled</strong>
        <Switch checked={config.enabled} label={`Enable ${config.name}`} onChange={(enabled) => { save({ enabled }) }} />
      </div>
      <OptionFields config={config} fields={kind?.optionFields ?? []} save={save} />
      {field('Chat model', (
        <select className="theme-model" data-testid={`resident-model-${config.id}`} value={config.model} onChange={(e) => { save({ model: e.target.value }) }}>
          <Options choices={RESIDENT_MODELS} value={config.model} />
        </select>
      ))}
      {kind !== undefined && kind.cycleMinutes !== null && field(
        'Check every',
        <CycleField config={config} defaultMinutes={kind.cycleMinutes} cycle={status?.cycle ?? null} save={save} />,
        'Apiary runs a check this often during its hours.',
      )}
      {field('Permissions', <PermissionModeSelect config={config} save={save} />, 'What it may do without asking. Anything else asks in its chat.')}
      {digests && field('Digest lookback', <LookbackField config={config} save={save} />, 'Older sessions are not digested. Changing this applies on the next pass.')}
      {digests && field('Digest model', (
        <select className="theme-model" data-testid={`resident-digest-model-${config.id}`} value={config.digestModel} onChange={(e) => { save({ digestModel: e.target.value }) }}>
          <Options choices={DIGEST_MODELS} value={config.digestModel} />
        </select>
      ))}
      {field('Days', (
        <div className="resident-days">
          {WEEK.map(([label, day]) => {
            const on = days.includes(day)
            return (
              <button
                key={day}
                type="button"
                className="view-toggle-segment resident-day"
                data-testid={`resident-day-${config.id}-${String(day)}`}
                data-active={on}
                aria-pressed={on}
                onClick={() => { save({ schedule: { ...config.schedule, days: on ? days.filter((d) => d !== day) : [...days, day] } }) }}
              >
                {label}
              </button>
            )
          })}
        </div>
      ))}
      {field('Hours', <HoursRow config={config} save={save} />)}
      {digests && field('Pause above usage', (
        <select
          className="theme-model"
          data-testid={`resident-pause-${config.id}`}
          value={config.pauseAboveUsagePercent}
          onChange={(e) => { save({ pauseAboveUsagePercent: Number(e.target.value) }) }}
        >
          <Options choices={PAUSE_LEVELS} value={config.pauseAboveUsagePercent} />
        </select>
      ), 'Background digesting pauses when your Claude usage is this high.')}
      <span className="muted" data-testid={`resident-duty-${config.id}`}>{dutyStatusText(config.schedule, now)}</span>
      {digests && <DigestLine id={config.id} digest={status?.digest ?? null} />}
      <div className="resident-actions">
        <button className="btn small" data-testid={`resident-open-${config.id}`} onClick={() => { openResidentPopup(config.id) }}>Open chat</button>
        <button className="btn small" data-testid={`resident-clear-${config.id}`} onClick={() => { onConfirm({ kind: 'clear', id: config.id, name: config.name }) }}>Clear chat history</button>
        {digests && <button className="btn small" data-testid={`resident-redigest-${config.id}`} onClick={() => { onConfirm({ kind: 'redigest', id: config.id, name: config.name }) }}>Re-digest everything</button>}
      </div>
      {error !== null && <span className="settings-help remote-pairing-error" role="alert">{error}</span>}
    </section>
  )
}

/**
 * Settings → Residents. Like Pets, each change is saved at once through `updateResident` rather
 * than on the dialog's Save. A list of cards: a kind with no instance offers an Add button, and
 * nothing here assumes there is only one resident.
 */
export function ResidentsSection(): JSX.Element {
  const configs = useAppSettings().residents
  const statuses = useResidents()
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [error, setError] = useState<string | null>(null)
  const kinds = useResidentKinds()
  const addable = kinds.filter((k) => !configs.some((c) => c.kind === k.id))

  const confirmed = (): void => {
    if (confirming === null) return
    const run = confirming.kind === 'clear' ? clearResident(confirming.id) : redigestResident(confirming.id)
    setConfirming(null)
    setError(null)
    Promise.resolve(run).catch((e: unknown) => { setError(describeError(e).message) })
  }

  return (
    <div className="residents-section" data-testid="residents-section">
      {addable.length > 0 && (
        <div className="resident-add-kinds">
          {addable.map((k) => (
            <div key={k.id} className="resident-add">
              <button
                className="btn primary"
                data-testid={`resident-add-${k.id}`}
                onClick={() => { setError(null); addResident(k.id).catch((e: unknown) => { setError(describeError(e).message) }) }}
              >
                Add {k.defaultName}
              </button>
              <span className="settings-help">{k.blurb}</span>
            </div>
          ))}
        </div>
      )}
      {configs.map((c) => (
        <ResidentCard key={c.id} config={c} kind={kinds.find((k) => k.id === c.kind)} status={statuses.find((s) => s.id === c.id)} onConfirm={setConfirming} />
      ))}
      {error !== null && <span className="settings-help remote-pairing-error" role="alert">{error}</span>}
      {confirming !== null && <ConfirmDialog confirming={confirming} onCancel={() => { setConfirming(null) }} onOk={confirmed} />}
    </div>
  )
}
