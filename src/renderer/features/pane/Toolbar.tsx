import type { ReactNode, RefObject, JSX } from 'react'
import { OverflowToolbar, type OverflowToolbarItem } from '../../ui/OverflowToolbar'

export interface ToolbarButtonSpec {
  id: string
  icon: ReactNode
  /** Text after the icon — omitted for icon-only buttons (pull/push/copy/+/list-toggle). */
  label?: string
  /** A small count after the label (the branch's behind/ahead). */
  badge?: string
  /** `shrink`: the label narrows to about 6em then hides; `collapse`: it hides whole, last of all. */
  labelMode?: 'shrink' | 'collapse'
  title: string
  testId: string
  onClick: () => void
  active?: boolean
  /** Sets `aria-expanded` (the shell toggle). */
  expanded?: boolean
  disabled?: boolean
  /** Set when something opens from this button and needs its box to position against. */
  buttonRef?: RefObject<HTMLButtonElement | null>
  /**
   * Colours a plugin's button: `suggest` for an offer (create a merge request), `problem` for
   * something needing attention. Plain buttons leave it unset.
   */
  tone?: 'normal' | 'suggest' | 'problem'
  /**
   * Overflow priority: lower numbers are more important and stay visible longer; higher numbers
   * move into the "More actions" menu first. Defaults to 20+ for the right group.
   */
  priority?: number
}

interface Props {
  /** The pinned start of the row: it never moves into the menu (its labels give way instead). */
  left: ToolbarButtonSpec[]
  /** The buttons, packed against the end; they move whole into the menu by priority. */
  right: ToolbarButtonSpec[]
  /** The git menu opens from the » button when its own button is in the overflow menu. */
  moreRef?: RefObject<HTMLButtonElement | null>
}

/**
 * Renders the bottom pane's header from an array of button descriptors instead of hardcoded
 * JSX per button, so a future button is one more array entry, not new markup wired in by hand at
 * every call site.
 *
 * On screen the order is left, then right, then the » button, always last. Items that do not fit
 * move, whole, into that menu.
 */
export function Toolbar({ left, right, moreRef }: Props): JSX.Element {
  const items: OverflowToolbarItem[] = [
    ...left.map((item) => toOverflowItem(item, 0, true, false)),
    ...right.map((item, idx) => toOverflowItem(item, idx + 20, false, true)),
  ]

  return (
    <div className="toolbar">
      <OverflowToolbar items={items} label="Shell actions" moreRef={moreRef} />
    </div>
  )
}

function toOverflowItem(spec: ToolbarButtonSpec, fallbackPriority: number, pinned: boolean, end: boolean): OverflowToolbarItem {
  return {
    id: spec.id,
    icon: spec.icon,
    label: spec.label,
    badge: spec.badge,
    labelMode: spec.labelMode,
    title: spec.title,
    testId: spec.testId,
    disabled: spec.disabled,
    active: spec.active,
    expanded: spec.expanded,
    tone: spec.tone,
    buttonRef: spec.buttonRef,
    priority: spec.priority ?? fallbackPriority,
    pinned,
    end,
    onClick: spec.onClick,
  }
}
