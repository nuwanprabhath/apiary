import type { ReactNode, RefObject } from 'react'

export interface ToolbarButtonSpec {
  id: string
  icon: ReactNode
  /** Text after the icon — omitted for icon-only buttons (pull/push/copy/+/list-toggle). */
  label?: string
  title: string
  testId: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  /** Set when something opens from this button and needs its box to position against. */
  buttonRef?: RefObject<HTMLButtonElement>
  /**
   * Colours a plugin's button: `suggest` for an offer (create a merge request), `problem` for
   * something needing attention. Plain buttons leave it unset.
   */
  tone?: 'normal' | 'suggest' | 'problem'
}

interface Props {
  left: ToolbarButtonSpec[]
  right: ToolbarButtonSpec[]
}

/**
 * Renders the bottom pane's header from an array of button descriptors instead of hardcoded
 * JSX per button, so a future button (the plan doc calls out a "+ new terminal" and a
 * "toggle terminal list" button coming next) is one more array entry, not new markup wired in
 * by hand at every call site.
 */
export function Toolbar({ left, right }: Props): JSX.Element {
  return (
    <div className="toolbar">
      <div className="toolbar-group">{left.map((b) => <ToolbarButton key={b.id} {...b} />)}</div>
      <div className="toolbar-group toolbar-group-right">
        {right.map((b) => <ToolbarButton key={b.id} {...b} />)}
      </div>
    </div>
  )
}

function ToolbarButton(spec: ToolbarButtonSpec): JSX.Element {
  return (
    <button
      ref={spec.buttonRef}
      className="toolbar-button"
      data-testid={spec.testId}
      data-active={spec.active ?? false}
      data-tone={spec.tone ?? 'normal'}
      title={spec.title}
      aria-label={spec.title}
      disabled={spec.disabled}
      onClick={spec.onClick}
    >
      {spec.icon}
      {spec.label !== undefined && <span className="toolbar-button-label">{spec.label}</span>}
    </button>
  )
}
