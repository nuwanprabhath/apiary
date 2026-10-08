import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useState } from 'react'
import { Popover } from '../../src/renderer/ui/Popover'
import { useEscape } from '../../src/renderer/ui/useEscape'
import { mountUi } from './mountUi'

function Demo({ restoreFocus }: { restoreFocus?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  useEscape(() => { setOpen(false) }, { enabled: open })
  return (
    <div>
      <button data-testid="trigger" onClick={() => { setOpen(true) }}>open</button>
      {open && (
        <Popover label="Find a thing" testId="popover" restoreFocus={restoreFocus}>
          <input data-testid="field" autoFocus />
        </Popover>
      )}
    </div>
  )
}

describe('Popover', () => {
  it('is a named dialog; closing it gives focus back to the control that opened it, despite the autofocused field', async () => {
    await mountUi(<Demo />)
    await userEvent.click(page.getByTestId('trigger'))
    const dialog = page.getByTestId('popover').element()
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Find a thing')
    expect(document.activeElement).toBe(page.getByTestId('field').element())

    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('popover')).not.toBeInTheDocument()
    await expect.poll(() => document.activeElement).toBe(page.getByTestId('trigger').element())
  })

  it('leaves focus alone when asked not to restore it', async () => {
    await mountUi(<Demo restoreFocus={false} />)
    await userEvent.click(page.getByTestId('trigger'))
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('popover')).not.toBeInTheDocument()
    await new Promise((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(resolve) }) })
    expect(document.activeElement).toBe(document.body)
  })
})
