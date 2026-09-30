import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppMenuNode } from '@shared/domain/windowChrome'
import { useEscape } from '../../ui/useEscape'
import { CheckIcon } from '../../ui/icons'

/**
 * The application menu, drawn in the theme instead of as a GTK/Win32 bar (Windows and Linux; a
 * Mac keeps its system menu bar). It draws main's real menu (`appMenu`) and runs items through it
 * (`appMenuInvoke`), so there is one menu: every command, label and shortcut is defined once in
 * `main/app/menu.ts`, and the shortcuts keep working because that menu is still the application
 * menu, only no longer shown by the OS.
 *
 * Focus is left where it was when a menu is opened by mouse (the terminal, a text box), and put
 * back before an item runs — Edit → Paste has to paste into whatever had focus, not into the menu.
 */
export function MenuBar(): JSX.Element {
  const [menu, setMenu] = useState<AppMenuNode[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const returnFocus = useRef<HTMLElement | null>(null)

  const load = (): void => {
    window.apiary.appMenu().then(setMenu).catch(() => { /* no menu is better than a broken one */ })
  }
  // Main sets the menu before opening any window, but a window it did not open itself (a reload
  // in development) can still ask first — so an empty answer is asked again, once, shortly after.
  useEffect(() => {
    let cancelled = false
    let retry: number | null = null
    window.apiary.appMenu().then((m) => {
      if (cancelled) return
      setMenu(m)
      if (m.length === 0) retry = window.setTimeout(load, 500)
    }).catch(() => {})
    return () => {
      cancelled = true
      if (retry !== null) window.clearTimeout(retry)
    }
  }, [])

  const openAt = (index: number | null): void => {
    // Re-read on every open: a checkbox or an enabled state can have changed since last time.
    if (index !== null) load()
    setOpen(index)
  }

  const close = (): void => {
    setOpen(null)
    const target = returnFocus.current
    returnFocus.current = null
    target?.focus()
  }

  const invoke = (path: number[]): void => {
    close()
    void window.apiary.appMenuInvoke(path)
  }

  useEffect(() => {
    if (open === null) return
    const onBlur = (): void => { setOpen(null) }
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('blur', onBlur) }
  }, [open])

  const top = menu.filter((m) => m.kind === 'submenu')
  const anchor = open !== null ? buttons.current[open]?.getBoundingClientRect() : undefined

  return (
    <nav className="menu-bar" aria-label="Application menu" data-testid="menu-bar">
      {top.map((m, i) => (
        <button
          key={m.label}
          ref={(el) => { buttons.current[i] = el }}
          type="button"
          className="menu-bar-item"
          data-testid={`menu-bar-${m.label.toLowerCase()}`}
          aria-haspopup="menu"
          aria-expanded={open === i}
          data-open={open === i}
          // Keeps focus where it was (a terminal, a text box) — see the component comment.
          onMouseDown={(e) => {
            e.preventDefault()
            if (open === null && document.activeElement instanceof HTMLElement) returnFocus.current = document.activeElement
          }}
          onClick={() => { openAt(open === i ? null : i) }}
          onMouseEnter={() => { if (open !== null && open !== i) openAt(i) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              if (open === null && document.activeElement instanceof HTMLElement) returnFocus.current = document.activeElement
              openAt(i)
            } else if (e.key === 'ArrowRight') {
              buttons.current[(i + 1) % top.length]?.focus()
            } else if (e.key === 'ArrowLeft') {
              buttons.current[(i - 1 + top.length) % top.length]?.focus()
            }
          }}
        >
          {m.label}
        </button>
      ))}
      {open !== null && anchor !== undefined && top[open]?.submenu !== undefined && (
        <MenuDropdown
          nodes={top[open].submenu}
          path={[menu.indexOf(top[open])]}
          at={{ x: anchor.left, y: anchor.bottom }}
          onInvoke={invoke}
          onClose={close}
          onSibling={(delta) => { openAt((open + delta + top.length) % top.length) }}
          testId="menu-bar-dropdown"
        />
      )}
    </nav>
  )
}

interface DropdownProps {
  nodes: AppMenuNode[]
  /** Path of this dropdown's parent item, in `appMenu`'s visible-item indices. */
  path: number[]
  at: { x: number; y: number }
  onInvoke: (path: number[]) => void
  onClose: () => void
  /** Left/Right at the top level moves to the neighbouring menu. Absent in a submenu. */
  onSibling?: (delta: 1 | -1) => void
  /** Left in a submenu closes just the submenu. */
  onBack?: () => void
  testId: string
}

function MenuDropdown({ nodes, path, at, onInvoke, onClose, onSibling, onBack, testId }: DropdownProps): JSX.Element {
  const root = useRef<HTMLUListElement | null>(null)
  const [sub, setSub] = useState<{ index: number; at: { x: number; y: number } } | null>(null)
  const [pos, setPos] = useState(at)
  useEscape(onBack ?? onClose)

  // Kept on screen: a submenu near the right edge opens to the left of its parent instead.
  useLayoutEffect(() => {
    const el = root.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos({
      x: at.x + r.width > window.innerWidth ? Math.max(0, window.innerWidth - r.width - 4) : at.x,
      y: at.y + r.height > window.innerHeight ? Math.max(0, window.innerHeight - r.height - 4) : at.y,
    })
    el.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus()
  }, [at])

  useEffect(() => {
    if (onBack !== undefined) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Element) || e.target.closest('.menu-dropdown, .menu-bar') === null) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [onBack, onClose])

  const items = (): HTMLElement[] => [...(root.current?.querySelectorAll<HTMLElement>(':scope > li > [role^="menuitem"]:not([disabled])') ?? [])]
  const openSub = (index: number, el: HTMLElement): void => {
    const r = el.getBoundingClientRect()
    setSub({ index, at: { x: r.right, y: r.top - 4 } })
  }

  return createPortal(
    <ul
      ref={root}
      className="menu-dropdown context-menu"
      role="menu"
      data-testid={testId}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        const list = items()
        const current = list.indexOf(document.activeElement as HTMLElement)
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          e.stopPropagation()
          const next = e.key === 'ArrowDown' ? (current + 1) % list.length : (current - 1 + list.length) % list.length
          list[next]?.focus()
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          e.stopPropagation()
          if (onBack !== undefined) onBack()
          else onSibling?.(-1)
        } else if (e.key === 'ArrowRight') {
          const el = document.activeElement as HTMLElement | null
          const index = el?.dataset.index !== undefined ? Number(el.dataset.index) : -1
          e.preventDefault()
          e.stopPropagation()
          if (index >= 0 && nodes[index]?.kind === 'submenu' && el !== null) openSub(index, el)
          else if (onBack === undefined) onSibling?.(1)
        }
      }}
    >
      {nodes.map((node, i) => {
        if (node.kind === 'separator') return <li key={`sep-${String(i)}`} role="separator" className="context-menu-separator" />
        const isSub = node.kind === 'submenu'
        return (
          <li key={`${node.label}-${String(i)}`} role="none">
            <button
              type="button"
              role={node.kind === 'checkbox' ? 'menuitemcheckbox' : node.kind === 'radio' ? 'menuitemradio' : 'menuitem'}
              aria-checked={node.kind === 'checkbox' || node.kind === 'radio' ? node.checked === true : undefined}
              aria-haspopup={isSub ? 'menu' : undefined}
              aria-expanded={isSub ? sub?.index === i : undefined}
              className="context-menu-item menu-dropdown-item"
              data-index={i}
              disabled={!node.enabled}
              onMouseEnter={(e) => { if (isSub) openSub(i, e.currentTarget); else setSub(null) }}
              onClick={(e) => {
                if (isSub) { openSub(i, e.currentTarget); return }
                onInvoke([...path, i])
              }}
            >
              <span className="menu-dropdown-check">
                {(node.kind === 'checkbox' || node.kind === 'radio') && node.checked === true && <CheckIcon />}
              </span>
              <span className="menu-dropdown-label">{node.label}</span>
              <span className="menu-dropdown-accel">{isSub ? '›' : node.accelerator ?? ''}</span>
            </button>
          </li>
        )
      })}
      {sub !== null && nodes[sub.index]?.submenu !== undefined && (
        <MenuDropdown
          nodes={nodes[sub.index].submenu ?? []}
          path={[...path, sub.index]}
          at={sub.at}
          onInvoke={onInvoke}
          onClose={onClose}
          onBack={() => {
            const index = sub.index
            setSub(null)
            root.current?.querySelector<HTMLElement>(`[data-index="${String(index)}"]`)?.focus()
          }}
          testId={`${testId}-sub`}
        />
      )}
    </ul>,
    document.body,
  )
}
