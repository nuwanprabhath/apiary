import type { JSX } from 'react'

interface Props {
  checked: boolean
  /** Standalone use: the switch is its own button, named by this. Omit it inside a row that is the control. */
  label?: string
  onChange?: (checked: boolean) => void
  testId?: string
}

/**
 * A pill switch. Inside a row that is itself the control (an option, a menu item) it is a drawing
 * only, and the row carries `aria-checked`; given a `label` it is a `role="switch"` button.
 */
export function Switch({ checked, label, onChange, testId }: Props): JSX.Element {
  if (label === undefined) return <span className="ui-switch" data-checked={checked} aria-hidden="true" />
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      className="ui-switch"
      data-checked={checked}
      onClick={() => { onChange?.(!checked) }}
    />
  )
}
