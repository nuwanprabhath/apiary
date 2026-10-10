/**
 * The UI audit: what a person spots at a glance and a functional test never asserts. It runs in
 * real Chromium against the real stylesheet (Vitest browser mode), on whatever is on screen, and
 * returns one violation per defect, each naming the element. `reviewUi` (./review.ts) fails the
 * test on any.
 *
 * Every rule here exists because an agent shipped that defect in 1.35.0 with all tests green:
 * the toolbar's "…" menu drawn as a bulleted list with no popup surface, its labels cut to "H..",
 * the find bar's buttons left as the browser's grey defaults, and a popup the transcript showed
 * through. Each rule is a question with a yes/no answer ("is this broken?"), not a taste call;
 * taste is the lead's screenshot review (.claude/skills/ui-review).
 *
 * An element that is meant to break a rule says so, with a reason, in `data-ui-allow`:
 * `data-ui-allow="clipped-text: a session title, full text in its tooltip"`. The reason is required.
 */

export type UiRule =
  | 'clipped-text'
  | 'cut-off'
  | 'overlap'
  | 'see-through-popup'
  | 'native-control'
  | 'list-marker'
  | 'misaligned-row'
  | 'low-contrast'
  | 'unnamed-control'

export interface UiViolation {
  rule: UiRule
  /** A readable path to the element: testid, role or tag with its classes. */
  where: string
  detail: string
}

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"]'
const POPUP = '[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [role="alertdialog"], [data-popup]'
/** Content, not chrome: prose the user or Claude wrote, where lists and long lines are content. */
const PROSE = '.markdown, [data-prose]'

export function describe(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  for (let i = 0; cur !== null && cur !== document.body && i < 3; i++, cur = cur.parentElement) {
    const id = cur.getAttribute('data-testid')
    const role = cur.getAttribute('role')
    const cls = [...cur.classList].slice(0, 2).join('.')
    parts.unshift(id !== null ? `[${id}]` : `${cur.tagName.toLowerCase()}${role !== null ? `[role=${role}]` : ''}${cls !== '' ? `.${cls}` : ''}`)
    if (id !== null) break
  }
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
  return `${parts.join(' > ')}${text !== '' ? ` "${text}"` : ''}`
}

function allowed(el: Element, rule: UiRule): boolean {
  for (let cur: Element | null = el; cur !== null; cur = cur.parentElement) {
    const allow = cur.getAttribute('data-ui-allow')
    if (allow === null) continue
    for (const entry of allow.split(';')) {
      const [name, reason] = entry.split(':')
      if (name?.trim() === rule && (reason ?? '').trim().length >= 8) return true
    }
  }
  return false
}

export function visible(el: Element): boolean {
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false
  if (el.closest('[aria-hidden="true"], [inert], [hidden]') !== null) return false
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  for (let cur: Element | null = el; cur !== null; cur = cur.parentElement) {
    const s = getComputedStyle(cur)
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || parseFloat(s.opacity) === 0) return false
  }
  // Clipped wholly out of view by an ancestor (a hint dropped to a hidden second line) is not seen.
  const c = clipBox(el)
  return r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom
}

/** The nearest ancestor that clips its content, and the box it clips to. */
function clipBox(el: Element): DOMRect {
  let box = new DOMRect(0, 0, window.innerWidth, window.innerHeight)
  for (let cur = el.parentElement; cur !== null; cur = cur.parentElement) {
    const s = getComputedStyle(cur)
    if (s.position === 'fixed') break
    const clipsX = s.overflowX !== 'visible'
    const clipsY = s.overflowY !== 'visible'
    if (!clipsX && !clipsY) continue
    const r = cur.getBoundingClientRect()
    const left = clipsX ? Math.max(box.left, r.left) : box.left
    const right = clipsX ? Math.min(box.right, r.right) : box.right
    const top = clipsY ? Math.max(box.top, r.top) : box.top
    const bottom = clipsY ? Math.min(box.bottom, r.bottom) : box.bottom
    box = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
  }
  return box
}

/** Inside a scrolling list, being partly scrolled out of view is normal, not a defect. */
function inScroller(el: Element): boolean {
  for (let cur = el.parentElement; cur !== null; cur = cur.parentElement) {
    const s = getComputedStyle(cur)
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight + 1) return true
    if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && cur.scrollWidth > cur.clientWidth + 1) return true
  }
  return false
}

function ownText(el: Element): string {
  let t = ''
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent ?? ''
  return t.trim()
}

function rgba(color: string): [number, number, number, number] {
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (m === null) return [0, 0, 0, 0]
  const p = (m[1] ?? '').split(/[\s,/]+/).filter(Boolean).map(Number)
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]
}

/** The colour actually behind `el`: its own and its ancestors' backgrounds composited. */
function effectiveBackground(el: Element): [number, number, number] {
  const layers: Array<[number, number, number, number]> = []
  for (let cur: Element | null = el; cur !== null; cur = cur.parentElement) {
    const c = rgba(getComputedStyle(cur).backgroundColor)
    if (c[3] > 0) layers.push(c)
    if (c[3] >= 1) break
  }
  let out: [number, number, number] = [0, 0, 0]
  const html = rgba(getComputedStyle(document.documentElement).backgroundColor)
  if (html[3] > 0) out = [html[0], html[1], html[2]]
  for (const [r, g, b, a] of layers.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)]
  return out
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The browser's own default look for a control, read from inside a shadow root where no app
 * stylesheet reaches. A control whose background and border still equal it was never styled.
 */
function uaDefault(el: HTMLElement): { background: string; border: string } {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.append(host)
  const probe = document.createElement(el.tagName.toLowerCase())
  if (el instanceof HTMLInputElement) probe.setAttribute('type', el.type)
  host.attachShadow({ mode: 'open' }).append(probe)
  const s = getComputedStyle(probe)
  const out = { background: s.backgroundColor, border: `${s.borderTopStyle} ${s.borderTopWidth} ${s.borderTopColor}` }
  host.remove()
  return out
}

/** Run every rule over what is on screen inside `root`. */
export function auditUi(root: Element = document.body): UiViolation[] {
  const out: UiViolation[] = []
  const add = (rule: UiRule, el: Element, detail: string): void => {
    if (!allowed(el, rule)) out.push({ rule, where: describe(el), detail })
  }
  const all = [...root.querySelectorAll('*')].filter(visible)

  for (const el of all) {
    if (!(el instanceof HTMLElement)) continue
    const s = getComputedStyle(el)
    const inProse = el.closest(PROSE) !== null

    // Text cut by its own box: a label reading "H.." or "dev…" tells nobody anything. Allowed only
    // where the full text is one hover away and at least a few characters still show.
    if (!inProse && ownText(el) !== '' && el.scrollWidth > el.clientWidth + 1 && s.overflowX !== 'visible') {
      const fullText = (el.textContent ?? '').trim()
      const hint = el.closest('[title], [aria-label]')
      const hinted = hint !== null && ((hint.getAttribute('title') ?? '') + (hint.getAttribute('aria-label') ?? '')).includes(fullText.slice(0, 12))
      const roomy = el.clientWidth >= parseFloat(s.fontSize) * 5
      if (!hinted || !roomy) add('clipped-text', el, `shows ${String(el.clientWidth)}px of ${String(el.scrollWidth)}px${hinted ? '' : ', and the full text is not in a tooltip'}`)
    }

    // Bullets in app chrome: a <ul> used for a menu without the menu's styling.
    if (el.tagName === 'LI' && !inProse && s.display === 'list-item' && s.listStyleType !== 'none') {
      add('list-marker', el, `shows a "${s.listStyleType}" marker; chrome lists use list-style: none`)
    }

    if (el.matches(INTERACTIVE)) {
      // Part of a control hidden by its container or the window: a half-drawn icon or button.
      if (!inScroller(el)) {
        const r = el.getBoundingClientRect()
        const c = clipBox(el)
        const over = Math.max(c.left - r.left, r.right - c.right, c.top - r.top, r.bottom - c.bottom)
        if (over > 1) add('cut-off', el, `${String(Math.round(over))}px of it is outside what its container shows`)
      }

      // Controls the app never styled: grey browser buttons, a white input on a dark theme.
      if (el.matches('button, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), select, textarea')) {
        const ua = uaDefault(el)
        const border = `${s.borderTopStyle} ${s.borderTopWidth} ${s.borderTopColor}`
        if (s.backgroundColor === ua.background && border === ua.border && rgba(ua.background)[3] > 0) {
          add('native-control', el, 'has the browser\'s default background and border; use the app\'s control classes (.btn, .icon-button, .input)')
        }
      }

      // An icon-only control must say what it does.
      if ((el.textContent ?? '').trim() === '' && el.matches('button, a[href], [role^="menuitem"]')) {
        const name = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.getAttribute('aria-labelledby')
        if (name === null || name.trim() === '') add('unnamed-control', el, 'icon-only, with no aria-label or title')
      }
    }

    // A popup the page shows through: transcript text bleeding across menu items.
    if (el.matches(POPUP)) {
      const bg = rgba(s.backgroundColor)
      const blurred = /blur\(\s*([\d.]+)px/.exec(s.backdropFilter)
      const opaqueEnough = bg[3] >= 0.9 || (blurred !== null && parseFloat(blurred[1] ?? '0') >= 8 && bg[3] >= 0.55)
      if (!opaqueEnough) add('see-through-popup', el, `background ${s.backgroundColor}, backdrop-filter ${s.backdropFilter}: what is behind shows through`)
    }

    // Readable text: WCAG's 3:1 floor for UI text (lenient; body text should reach 4.5).
    if (ownText(el) !== '' && !el.matches(':disabled, [aria-disabled="true"]') && el.closest(':disabled, [aria-disabled="true"], [data-stale="true"]') === null) {
      const fg = rgba(s.color)
      const bg = effectiveBackground(el)
      const shown: [number, number, number] = [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])]
      const ratio = contrast(shown, bg) * parseFloat(s.opacity)
      if (ratio < 3) add('low-contrast', el, `contrast ${ratio.toFixed(2)}:1 against its background (needs 3:1)`)
    }
  }

  // A toolbar's controls sit on one line: one that drops below or floats above the row looks broken.
  for (const bar of root.querySelectorAll('[role="toolbar"]')) {
    if (!visible(bar)) continue
    const items = [...bar.children].filter((c) => visible(c) && getComputedStyle(c).position !== 'absolute' && getComputedStyle(c).position !== 'fixed')
    const centres = items.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2 })
    const first = centres[0]
    if (first === undefined) continue
    items.forEach((c, i) => {
      const off = Math.abs((centres[i] ?? first) - first)
      if (off > 2) add('misaligned-row', c, `${String(Math.round(off))}px off the toolbar's line`)
    })
  }

  // Two controls, or two pieces of text, drawn over each other in the same layer.
  const leaves = all.filter((el) => el.matches(INTERACTIVE) || (ownText(el) !== '' && el.closest(PROSE) === null))
  const layerOf = (el: Element): Element | null => el.closest(POPUP)
  for (let i = 0; i < leaves.length; i++) {
    const a = leaves[i]
    if (a === undefined) continue
    const ra = a.getBoundingClientRect()
    for (let j = i + 1; j < leaves.length; j++) {
      const b = leaves[j]
      if (b === undefined || a.contains(b) || b.contains(a) || layerOf(a) !== layerOf(b)) continue
      const rb = b.getBoundingClientRect()
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (w > 2 && h > 2) add('overlap', a, `overlaps ${describe(b)} by ${String(Math.round(w))}×${String(Math.round(h))}px`)
    }
  }
  return out
}
