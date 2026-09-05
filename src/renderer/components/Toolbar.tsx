import type { ReactNode } from 'react'

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
      className="toolbar-button"
      data-testid={spec.testId}
      data-active={spec.active ?? false}
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
