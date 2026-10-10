import { type JSX, useEffect, useRef, useState } from 'react'
import type { EditCommand } from '@shared/domain/contextMenu'
import { ContextMenu } from '../../ui/ContextMenu'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { editableOf, isSpellcheckable } from '../../ui/editableText'
import { checkSpelling, onContextMenuRequested, sendEditCommand } from '../../state/spelling'
import { suggestionItems, textMenuItems } from './textMenu'
import { snapshotCaret, wordAtCaret } from './textTarget'

interface OpenMenu {
  testId: string
  x: number
  y: number
  items: ContextMenuItem[]
  focusOnOpen: boolean
}

interface PendingEdit {
  command: EditCommand
  restore: () => void
}

/**
 * The menus for text: right-click on an editable field or selected text, and left-click on a
 * misspelled word. Both are the app's own `ContextMenu`, opened where the pointer is.
 */
export function TextMenuHost(): JSX.Element | null {
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  // The DOM contextmenu event comes before main's request for it, so its target is kept until then.
  const lastTarget = useRef<Element | null>(null)
  // Chromium pastes or replaces into whatever has focus, so an edit waits until the menu has closed.
  const pending = useRef<PendingEdit | null>(null)

  useEffect(() => {
    const recordTarget = (event: MouseEvent): void => {
      lastTarget.current = event.target instanceof Element ? event.target : null
    }
    const offRequest = onContextMenuRequested((request) => {
      const target = lastTarget.current
      const field = editableOf(target)
      if (field === null && target !== null && target.closest('[data-own-context-menu]') !== null) return
      const restore = snapshotCaret(field)
      const items = textMenuItems(request, { edit: (command) => { pending.current = { command, restore } } })
      if (items.length === 0) return
      setMenu({ testId: 'text-menu', x: request.x, y: request.y, items, focusOnOpen: true })
    })
    document.addEventListener('contextmenu', recordTarget, true)
    return () => {
      document.removeEventListener('contextmenu', recordTarget, true)
      offRequest()
    }
  }, [])

  useEffect(() => {
    const spellAtPointer = (event: MouseEvent): void => {
      if (event.button !== 0) return
      const field = editableOf(event.target)
      if (field === null || !isSpellcheckable(field)) return
      const typed = wordAtCaret(field)
      if (typed === null) return
      const { misspelled, suggestions } = checkSpelling(typed.word)
      if (!misspelled || suggestions.length === 0) return
      setMenu({
        testId: 'spelling-menu',
        x: event.clientX,
        y: event.clientY,
        items: suggestionItems(suggestions, (word) => { typed.replace(word) }),
        focusOnOpen: false,
      })
    }
    document.addEventListener('mouseup', spellAtPointer, true)
    return () => { document.removeEventListener('mouseup', spellAtPointer, true) }
  }, [])

  useEffect(() => {
    if (menu !== null || pending.current === null) return
    const { command, restore } = pending.current
    pending.current = null
    restore()
    sendEditCommand(command)
  }, [menu])

  if (menu === null) return null
  return (
    <ContextMenu
      items={menu.items}
      position={{ x: menu.x, y: menu.y }}
      onClose={() => { setMenu(null) }}
      testId={menu.testId}
      focusOnOpen={menu.focusOnOpen}
    />
  )
}
