import { type JSX, useEffect } from 'react'
import type { AccountId, SessionId } from '@shared/domain/ids'
import { answerSwitchQuestion, settleIdle, useSwitchQuestion, useWaitingSwitches } from '../../state/accountSwitch'
import { accountById, useAccounts } from '../../state/accountsStore'
import { useSessionBusy } from '../../state/sessionBusy'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'

/**
 * Asked when the person picks another account for a session that is mid-reply: switching restarts
 * its `claude`, which ends the reply. Esc is "Don't switch".
 */
function AccountSwitchPrompt({ accountId }: { accountId: AccountId }): JSX.Element {
  const label = accountById(useAccounts(), accountId)?.label ?? accountId
  const dismiss = (): void => { answerSwitchQuestion('none') }
  return (
    <ErrorBoundary label="This dialog">
      <Modal
        testId="account-switch-prompt"
        titleId="account-switch-title"
        onClose={dismiss}
        initialFocusSelector='[data-testid="account-switch-now"]'
      >
        <h2 id="account-switch-title">Claude is still replying</h2>
        <p>Switching to <strong>{label}</strong> restarts this session. What should happen to the current reply?</p>
        <div className="modal-actions">
          <button className="btn primary" data-testid="account-switch-now" onClick={() => { answerSwitchQuestion('now') }}>
            Stop and switch
          </button>
          <button className="btn" data-testid="account-switch-later" onClick={() => { answerSwitchQuestion('later') }}>
            Switch when it finishes
          </button>
          <button className="btn" data-testid="account-switch-none" onClick={dismiss}>Don’t switch</button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}

/** Carries out a waiting switch the moment its session stops replying. */
function IdleWatch({ sessionId }: { sessionId: SessionId }): null {
  const busy = useSessionBusy(sessionId)
  useEffect(() => { if (!busy) settleIdle(sessionId) }, [busy, sessionId])
  return null
}

/** Mounted once per window: the busy question, and a watcher for each session waiting to switch. */
export function AccountSwitchHost(): JSX.Element {
  const asking = useSwitchQuestion()
  const pending = useWaitingSwitches()
  return (
    <ErrorBoundary label="Account switching" fallback={null}>
      {asking !== null && <AccountSwitchPrompt accountId={asking.accountId} />}
      {[...pending.keys()].map((id) => <IdleWatch key={id} sessionId={id} />)}
    </ErrorBoundary>
  )
}
