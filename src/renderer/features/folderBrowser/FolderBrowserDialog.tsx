import type { JSX } from 'react'
import type { NewSessionInfo } from '@shared/domain/session'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { BranchIcon, FolderIcon, ArrowUpIcon } from '../../ui/icons'
import { Listbox, optionId } from '../../ui/Listbox'
import { Modal } from '../../ui/Modal'
import { collapseCrumbs } from './crumbs'
import { useFolderBrowse, type FolderBrowse } from './useFolderBrowse'

interface Props {
  /** The work machine's name, for the title. */
  host: string
  /** A session was started in the folder being shown. */
  onStarted: (info: NewSessionInfo) => void
  onClose: () => void
}

function Crumbs({ b }: { b: FolderBrowse }): JSX.Element {
  const items = b.view === null ? [] : collapseCrumbs(b.view.crumbs)
  return (
    <nav className="folder-browser-crumbs" aria-label="Path" data-testid="folder-crumbs">
      {items.map((c, i) => (
        <span key={`${String(i)}-${c.label}`} className="folder-crumb-item">
          {i > 0 && <span className="folder-crumb-sep" aria-hidden="true">›</span>}
          {c.index !== null ? (
            <button
              type="button"
              className="folder-crumb"
              data-testid="folder-crumb"
              disabled={b.busy}
              onClick={() => { if (c.index !== null) b.jump(c.index) }}
            >
              {c.label}
            </button>
          ) : (
            <span className="folder-crumb folder-crumb-here" title={c.title ?? c.label} data-testid="folder-crumb-here">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}

function Rows({ b }: { b: FolderBrowse }): JSX.Element {
  return (
    <div className="folder-browser-box">
      <Listbox
        label={`Folders in ${b.here}`}
        testId="folder-list"
        className="folder-browser-list"
        tabIndex={0}
        activeId={b.activeIndex >= 0 ? optionId('folder-list', b.activeIndex) : undefined}
        onKeyDown={b.onKeyDown}
      >
        {b.entries.map((entry, i) => (
          <div
            key={entry.name}
            id={optionId('folder-list', i)}
            role="option"
            aria-selected={entry.name === b.selected}
            className={`folder-row${entry.name === b.selected ? ' selected' : ''}`}
            data-testid="folder-row"
            title={entry.name}
            onClick={() => { b.select(entry.name) }}
            onDoubleClick={() => { b.enter(entry.name) }}
          >
            {entry.isRepo ? <BranchIcon className="folder-row-icon" /> : <FolderIcon className="folder-row-icon" />}
            <span className="folder-row-name">{entry.name}</span>
          </div>
        ))}
      </Listbox>
      {b.view === null && b.error === null && <p className="folder-browser-note" data-testid="folder-loading">Loading…</p>}
      {b.view !== null && b.entries.length === 0 && <p className="folder-browser-note" data-testid="folder-empty">No folders in here.</p>}
    </div>
  )
}

/**
 * "Choose a folder on HOST": the in-app stand-in for the native folder picker, which would open on
 * the work machine's screen. The work machine holds where the browse is; this shows its view and
 * sends a child's name, a crumb index or "up" (ADR-0001). "Start session" starts in the folder
 * being shown, not the row that is selected, which is why the button names that folder.
 */
export function FolderBrowserDialog({ host, onStarted, onClose }: Props): JSX.Element {
  const b = useFolderBrowse(onStarted)
  return (
    <ErrorBoundary label="This dialog">
      <Modal
        testId="folder-browser"
        titleId="folder-browser-title"
        onClose={onClose}
        initialFocusSelector='[data-testid="folder-list"]'
        wide
      >
        <h2 id="folder-browser-title" className="folder-browser-title" title={`Choose a folder on ${host}`}>
          Choose a folder on {host}
        </h2>
        <div className="folder-browser-bar">
          <Crumbs b={b} />
          <button type="button" className="btn small" data-testid="folder-up" disabled={b.atRoot || b.busy} onClick={b.up}>
            <ArrowUpIcon className="folder-up-icon" /> Up
          </button>
        </div>
        <Rows b={b} />
        {b.error !== null && <p className="folder-browser-error" role="alert" data-testid="folder-error">{b.error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="folder-cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn primary folder-start"
            data-testid="folder-start"
            disabled={b.view === null || b.busy}
            title={b.view === null ? undefined : `Start session in ${b.here}`}
            onClick={b.start}
          >
            <span className="folder-start-label">Start session in {b.here === '' ? 'this folder' : b.here}</span>
          </button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}
