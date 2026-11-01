import { useCallback, useRef, useState, type JSX } from 'react'
import { focusAskedFor } from '../../ui/focusUnlessTyping'
import { dismissUpdate, installUpdateWithPassword } from '../../state/updateStore'

/**
 * The password sudo asked for, typed into the banner rather than a polkit dialog: Apiary is often
 * started over SSH, where no polkit agent exists. The text leaves React state the moment it is sent,
 * so a refused password comes back to an empty field.
 */
export function UpdatePasswordForm({ host }: { host: string | null }): JSX.Element {
  const [password, setPassword] = useState('')
  const field = useRef<HTMLInputElement | null>(null)
  // Stable, so focusing (which selects the text) happens once when the field appears, not per keystroke.
  const attach = useCallback((el: HTMLInputElement | null) => { field.current = el; focusAskedFor(el) }, [])
  const send = (): void => {
    const typed = password
    setPassword('')
    installUpdateWithPassword(typed)
    // Back to the field after a click on Install, so a refused password is retyped straight away.
    focusAskedFor(field.current)
  }
  return (
    <form
      className="update-password"
      onSubmit={(e) => { e.preventDefault(); send() }}
    >
      <input
        ref={attach}
        className="search update-password-input"
        data-testid="update-password"
        type="password"
        autoComplete="current-password"
        aria-label={host === null ? 'Your password for sudo' : `Your password on ${host}`}
        value={password}
        onChange={(e) => { setPassword(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); dismissUpdate() }
        }}
      />
      <button className="btn primary" type="submit" data-testid="update-password-submit" disabled={password === ''}>
        Install
      </button>
      <button className="btn" type="button" data-testid="update-password-cancel" onClick={() => { dismissUpdate() }}>
        Cancel
      </button>
    </form>
  )
}
