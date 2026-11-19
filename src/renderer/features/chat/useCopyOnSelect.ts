import { createElement, type JSX, type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useEffect, useState } from 'react'
import { ContextMenu } from '../../ui/ContextMenu'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { useNotifications } from '../../ui/notifications'
import { copyRich, copyText } from '../../state/clipboard'
import { selectionFragmentWithin, selectionHtmlWithin, selectionInOneBlock } from './selectionHtml'
import { hasStructure, selectionText } from './selectionText'

/** The selected text when it is non-empty and lies wholly inside `root`, else ''. */
function selectionWithin(root: HTMLElement | null): string {
  const sel = window.getSelection()
  if (root === null || sel === null || sel.isCollapsed || sel.rangeCount === 0) return ''
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return ''
  // List numbers and bullets are CSS markers, so they are not in `toString()`: a selection that
  // crosses blocks is written out as text that has them. Inside one block it copies as selected,
  // since a fragment of a sentence is for a terminal or a browser, not a list.
  // A triple-click's range ends in the next block, which adds a newline the person did not select.
  if (selectionInOneBlock(root)) return sel.toString().replace(/\n+$/, '')
  const fragment = selectionFragmentWithin(root)
  return fragment !== null && hasStructure(fragment) ? selectionText(fragment) : sel.toString()
}

/** The address of the link under the pointer (a web or mail link, as the markdown allows), or ''. */
function linkAt(target: EventTarget | null): string {
  const href = target instanceof Element ? target.closest('a[href]')?.getAttribute('href') ?? '' : ''
  return /^(https?:|mailto:)/i.test(href) ? href : ''
}

function inTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea') !== null
}

/**
 * Copy-on-select for a read-only region (the chat transcript), like the terminal: releasing the
 * mouse over a non-empty selection inside `ref` copies it and says how much was copied. Also a
 * right-click menu with "Copy", enabled only while something is selected, and "Copy link address"
 * when the click was on a link.
 *
 * Wire up: `const { onContextMenu, menu } = useCopyOnSelect(ref)`; put `ref` and `onContextMenu`
 * on the element and render `{menu}` anywhere. Needs a NotificationProvider above it.
 */
export function useCopyOnSelect(ref: RefObject<HTMLElement | null>): {
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void
  menu: JSX.Element | null
} {
  const { notify } = useNotifications()
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [selected, setSelected] = useState('')
  const [selectedHtml, setSelectedHtml] = useState('')
  const [link, setLink] = useState('')

  const copy = useCallback((text: string): void => {
    void copyText(text).then((ok) => {
      if (ok) notify({ kind: 'success', message: `Copied ${text.length} chars to clipboard`, timeoutMs: 2000 })
    })
  }, [notify])

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 0 || inTextField(e.target)) return
      const text = selectionWithin(el)
      if (text !== '') copy(text)
    }
    // The browser's own Ctrl/Cmd+C: the same text, and the selection's HTML so a paste keeps real lists.
    const onCopy = (e: ClipboardEvent): void => {
      if (inTextField(e.target) || e.clipboardData === null) return
      const text = selectionWithin(el)
      if (text === '') return
      e.preventDefault()
      e.clipboardData.setData('text/plain', text)
      const html = selectionInOneBlock(el) ? '' : selectionHtmlWithin(el)
      if (html !== '') e.clipboardData.setData('text/html', html)
    }
    el.addEventListener('mouseup', onMouseUp)
    el.addEventListener('copy', onCopy)
    return () => {
      el.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('copy', onCopy)
    }
  }, [ref, copy])

  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLElement>): void => {
    if (inTextField(e.target)) return
    e.preventDefault()
    // Read at open, so "Copy" reflects the selection as it is at that moment.
    setSelected(selectionWithin(ref.current))
    setSelectedHtml(selectionHtmlWithin(ref.current))
    setLink(linkAt(e.target))
    setPosition({ x: e.clientX, y: e.clientY })
  }, [ref])

  const linkItems: ContextMenuItem[] = link === '' ? [] : [{
    id: 'copy-link',
    label: 'Copy link address',
    run: () => {
      void copyText(link).then((ok) => { if (ok) notify({ kind: 'success', message: 'Copied link address', timeoutMs: 2000 }) })
    },
  }]
  const items: ContextMenuItem[] = [
    ...linkItems,
    { id: 'copy', label: 'Copy', disabled: selected === '', run: () => { copy(selected) } },
    {
      id: 'copy-formatted',
      label: 'Copy with formatting',
      disabled: selected === '' || selectedHtml === '',
      run: () => {
        void copyRich(selectedHtml, selected).then((ok) => {
          if (ok) notify({ kind: 'success', message: 'Copied with formatting', timeoutMs: 2000 })
        })
      },
    },
  ]
  const menu = position === null
    ? null
    : createElement(ContextMenu, { items, position, onClose: () => { setPosition(null) }, testId: 'copy-menu' })
  return { onContextMenu, menu }
}
