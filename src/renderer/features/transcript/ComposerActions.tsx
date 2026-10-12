import type { PtyId } from '@shared/domain/ids'
import { type JSX, type ReactNode, useCallback, useState } from 'react'
import { useNotifications } from '../../ui/notifications'
import { sendPrompt } from '../../state/terminals'

/** Model choices offered by the picker. `null` means "leave whatever the session is using". */
const MODELS = ['default', 'opus', 'sonnet', 'haiku'] as const
type Model = (typeof MODELS)[number]

interface Props {
  ptyId: PtyId | null
  running: boolean
  chatMode: boolean
  busy: boolean
  hint: string
  /** The fold button, first in the row. */
  leading: ReactNode
  /** While the box is folded: the button that unfolds it, in the hint's place. */
  peek: ReactNode
  /** Chat mode only: the "/" menu, context ring and model picker, before the hint. */
  chatControls: ReactNode
  /** Chat mode only: the permission mode menu, after the hint. */
  modeMenu: ReactNode
  /** Whether the Send button has nothing to send or is not allowed to. */
  sendDisabled: boolean
  sending: boolean
  send: () => void
  interrupt: () => void
}

/** The row under the box: the chat's pickers or the model switch, the hint, and Send or Stop. */
export function ComposerActions(p: Props): JSX.Element {
  const { running, chatMode, busy, hint, sending } = p
  return (
    <div className="composer-actions">
      {p.leading}
      {p.chatControls}
      {!chatMode && <TerminalModelSelect ptyId={p.ptyId} running={running} />}
      {p.peek ?? <span className="composer-hint muted" data-testid="composer-hint"><span className="composer-hint-text">{hint}</span></span>}
      {p.modeMenu}
      {busy ? (
        <button className="btn composer-send" data-testid="composer-stop" title="Stop Claude (Esc)" onClick={p.interrupt}>
          Stop
        </button>
      ) : (
        <button
          className="primary composer-send"
          data-testid="composer-send"
          disabled={p.sendDisabled}
          // The hint is hidden when the footer is narrow; this keeps its words reachable.
          title={hint === '' ? undefined : hint}
          onClick={p.send}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      )}
    </div>
  )
}

/** The model switch for a session in its terminal: types Claude Code's own `/model`. */
function TerminalModelSelect({ ptyId, running }: { ptyId: PtyId | null, running: boolean }): JSX.Element {
  const { notify, notifyError } = useNotifications()
  const [model, setModel] = useState<Model>('default')
  const choose = useCallback(async (next: Model): Promise<void> => {
    setModel(next)
    if (!running || ptyId === null) return
    try {
      // `/model` is Claude Code's own command; this types it for you rather than reimplementing it.
      await sendPrompt(ptyId, `/model ${next}`)
      notify({ kind: 'info', message: `Asked the session to switch to ${next}.` })
    } catch (e) {
      notifyError(e, 'Could not switch model')
    }
  }, [running, ptyId, notify, notifyError])
  return (
    <label className="composer-model">
      <span className="muted">Model</span>
      <select
        data-testid="composer-model"
        value={model}
        disabled={!running}
        title={running ? 'Switch this session’s model' : 'Resume the session to change its model'}
        onChange={(e) => { void choose(e.target.value as Model) }}
      >
        {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </label>
  )
}
