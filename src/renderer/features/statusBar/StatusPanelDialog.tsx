import type { JSX } from 'react'
import type { StatusBarPanel } from '@shared/domain/statusBar'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'
import { StatusSections } from './StatusSections'

interface Props {
  title: string
  /** Null while it loads. */
  panel: StatusBarPanel | null
  onClose: () => void
  onRefresh: () => void
  onOpenSettings: () => void
}

/** A status-bar item's dashboard — the usage extension's webview panel, as an Apiary dialog. */
export function StatusPanelDialog({ title, panel, onClose, onRefresh, onOpenSettings }: Props): JSX.Element {
  return (
    <ErrorBoundary label="This dialog">
      <Modal testId="status-panel" titleId="status-panel-title" onClose={onClose} wide closeOnBackdropClick className="status-panel">
        <h2 id="status-panel-title">{title}</h2>
        {panel === null ? <p className="muted">Loading…</p> : <StatusSections sections={panel.sections} />}
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="status-panel-settings" onClick={onOpenSettings}>Settings…</button>
          {panel?.refreshable === true && (
            <button type="button" className="btn" data-testid="status-panel-refresh" onClick={onRefresh}>Refresh</button>
          )}
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}
