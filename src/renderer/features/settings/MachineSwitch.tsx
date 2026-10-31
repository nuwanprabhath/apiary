import type { JSX } from 'react'
import { thisComputerName, type SettingsTarget } from '../../state/settingsStore'

/** `‹host› | This Mac` at the top of Settings in a remote window: whose settings the dialog edits. */
export function MachineSwitch(
  { host, target, onChange }: { host: string; target: SettingsTarget; onChange: (next: SettingsTarget) => void },
): JSX.Element {
  return (
    <div className="view-toggle settings-machine-switch" role="group" aria-label="Whose settings" data-testid="settings-machine-switch">
      <button
        type="button" className="view-toggle-segment" data-testid="settings-machine-remote"
        data-active={target === 'machine'} aria-pressed={target === 'machine'}
        onClick={() => { onChange('machine') }}
      >
        {host}
      </button>
      <button
        type="button" className="view-toggle-segment" data-testid="settings-machine-this"
        data-active={target === 'this'} aria-pressed={target === 'this'}
        onClick={() => { onChange('this') }}
      >
        {thisComputerName()}
      </button>
    </div>
  )
}

/** Under the work machine's sections: why themes, pets and animations are not among them. */
export function ScreenSettingsNote({ onSwitch }: { onSwitch: () => void }): JSX.Element {
  const here = thisComputerName()
  return (
    <p className="settings-help settings-screen-note" data-testid="settings-screen-note">
      <span>Themes, pets and animations are {here.replace(/^This/, 'this')}&apos;s own.</span>
      <button type="button" className="btn small" data-testid="settings-switch-to-this" onClick={onSwitch}>Switch to {here}</button>
    </p>
  )
}
