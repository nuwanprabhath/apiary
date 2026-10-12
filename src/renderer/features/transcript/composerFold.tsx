import { type JSX, type RefObject, useEffect, useId, useRef } from 'react'
import { useComposerCollapsed } from '../../state/composerCollapsed'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'

export interface ComposerFold {
  collapsed: boolean
  /** The id the fold button controls: the message box's. */
  inputId: string
  toggle: () => void
}

/** Folding the message box away, one preference for every composer, and focusing it on unfold. */
export function useComposerFold(textareaRef: RefObject<HTMLTextAreaElement | null>): ComposerFold {
  const [collapsed, setCollapsed] = useComposerCollapsed()
  const inputId = useId()
  /** Set when the person unfolds the box, so it takes focus once it exists again. */
  const focusOnShow = useRef(false)
  useEffect(() => {
    if (collapsed || !focusOnShow.current) return
    focusOnShow.current = false
    textareaRef.current?.focus()
  }, [collapsed, textareaRef])
  const toggle = (): void => {
    if (collapsed) focusOnShow.current = true
    setCollapsed(!collapsed)
  }
  return { collapsed, inputId, toggle }
}

/** The first button of the actions row: folds the message box away or brings it back. */
export function FoldButton({ fold }: { fold: ComposerFold }): JSX.Element {
  const label = fold.collapsed ? 'Show the message box' : 'Hide the message box'
  return (
    <button
      className="btn composer-collapse"
      data-testid="composer-collapse"
      aria-expanded={!fold.collapsed}
      aria-controls={fold.inputId}
      aria-label={label}
      title={label}
      onClick={fold.toggle}
    >
      <ChevronIcon expanded={!fold.collapsed} />
    </button>
  )
}

/** While folded, in the hint's place: unfolds the box, and shows the draft's first line if any. */
export function PeekButton({ fold, draft }: { fold: ComposerFold, draft: string }): JSX.Element {
  const firstLine = draft.trim().split('\n')[0] ?? ''
  return (
    <button
      className="btn composer-peek"
      data-testid="composer-peek"
      // The room is whatever the row leaves, which in a narrow pane is little: the words stay reachable.
      title={firstLine === '' ? 'Message Claude…' : firstLine}
      onClick={fold.toggle}
    >
      {firstLine === '' ? 'Message Claude…' : firstLine}
    </button>
  )
}
