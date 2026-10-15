import type { JSX } from 'react'

/** One option of the "/" menu: the button every group draws its rows with. */
export function Row({ id, selected, testId, extra, title, onEnter, onClick, children }: {
  id: string
  selected: boolean
  testId: string
  extra: Record<string, string>
  title?: string
  onEnter: () => void
  onClick: () => void
  children: JSX.Element[]
}): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      className="chat-command-option"
      data-testid={testId}
      title={title}
      onMouseEnter={onEnter}
      onClick={onClick}
      ref={(el) => { if (selected) el?.scrollIntoView?.({ block: 'nearest' }) }}
      {...extra}
    >
      {children}
    </button>
  )
}
