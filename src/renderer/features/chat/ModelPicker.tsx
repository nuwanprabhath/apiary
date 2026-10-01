import type { JSX } from 'react'
import {
  CHAT_EFFORTS, CHAT_EFFORT_LABELS, CHAT_MODELS, modelLabel,
  type ChatEffort, type ChatModelInfo,
} from '@shared/domain/chat'
import { CheckIcon } from '../../ui/icons'
import { usePopover } from './usePopover'

interface Props {
  /** The model running (or, before the chat starts, the one picked to start with). */
  model: string | null
  effort: ChatEffort | null
  /** claude's own list once the chat runs; before that, the aliases every claude knows. */
  models: readonly ChatModelInfo[] | null
  onModel: (value: string) => void
  onEffort: (effort: ChatEffort) => void
}

/**
 * The model button in the message box, as the extension has it: the model actually running and
 * its effort ("Opus 5.5 · Medium"), opening a list of claude's models with an effort scale under
 * it. The name is what claude reports it is running, so it cannot disagree with Claude's own
 * answer to "which model are you".
 */
export function ModelPicker({ model, effort, models, onModel, onEffort }: Props): JSX.Element {
  const { open, setOpen, root } = usePopover()
  const list = models ?? CHAT_MODELS
  const current = list.find((m) => m.value !== 'default' && (m.resolvedModel === model || m.value === model))
    ?? list.find((m) => m.value === model)
  // Effort levels: the running model's own, or every level before claude has said.
  const efforts: readonly ChatEffort[] = models === null ? CHAT_EFFORTS : current?.efforts ?? []

  return (
    <div className="chat-model" ref={root}>
      <button
        type="button"
        className="chat-model-pill"
        data-testid="composer-model-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose the model and effort"
        onClick={() => { setOpen(!open) }}
      >
        <span className="chat-model-name">{modelLabel(model, models)}</span>
        {effort !== null && efforts.length > 0 && <span className="chat-model-effort">{CHAT_EFFORT_LABELS[effort]}</span>}
      </button>
      {open && (
        <div className="chat-model-menu" role="menu" data-testid="composer-model-menu">
          <div className="chat-model-heading">Select a model</div>
          <div className="chat-model-list">
            {list.map((m) => {
              const selected = m === current
              return (
                <button
                  key={m.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className="chat-model-option"
                  data-testid="composer-model-option"
                  data-value={m.value}
                  onClick={() => { onModel(m.value); setOpen(false) }}
                >
                  <span className="chat-model-option-text">
                    <span className="chat-model-option-name">{m.displayName}</span>
                    {m.description !== '' && <span className="chat-model-option-desc">{m.description}</span>}
                  </span>
                  {selected && <CheckIcon />}
                </button>
              )
            })}
          </div>
          {efforts.length > 0 && (
            <div className="chat-effort" data-testid="composer-effort">
              <span>Effort <span className="muted">({effort !== null ? CHAT_EFFORT_LABELS[effort] : 'default'})</span></span>
              <span className="chat-effort-scale" role="radiogroup" aria-label="Effort">
                {efforts.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={level === effort}
                    aria-label={CHAT_EFFORT_LABELS[level]}
                    title={CHAT_EFFORT_LABELS[level]}
                    className="chat-effort-dot"
                    data-testid={`composer-effort-${level}`}
                    data-on={level === effort}
                    onClick={() => { onEffort(level) }}
                  />
                ))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** How full Claude's context is, as a ring with the percentage inside it. */
export function ContextRing({ used, window: size }: { used: number; window: number }): JSX.Element {
  const pct = Math.min(100, Math.round((used / size) * 100))
  const r = 9
  const circumference = 2 * Math.PI * r
  return (
    <span
      className="chat-context"
      data-testid="composer-context"
      data-level={pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'ok'}
      title={`${used.toLocaleString()} of ${size.toLocaleString()} tokens of context used`}
      aria-label={`${String(pct)}% of context used`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="chat-context-track" cx="12" cy="12" r={r} />
        <circle
          className="chat-context-fill"
          cx="12" cy="12" r={r}
          strokeDasharray={`${String((pct / 100) * circumference)} ${String(circumference)}`}
          transform="rotate(-90 12 12)"
        />
        <text x="12" y="12" className="chat-context-text">{pct}</text>
      </svg>
    </span>
  )
}
