/** Copied chat text keeps the numbers and bullets that are only CSS markers on screen. */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useRef } from 'react'
import { createFakeApiary } from './fakeApiary'
import { NotificationProvider } from '../../src/renderer/ui/notifications'
import { useCopyOnSelect } from '../../src/renderer/features/chat/useCopyOnSelect'
import { selectionFragmentWithin } from '../../src/renderer/features/chat/selectionHtml'
import { selectionText } from '../../src/renderer/features/chat/selectionText'

const HTML = `
<p id="intro">Steps to take:</p>
<ol id="steps"><li id="s1">Open it</li><li id="s2">Run <code>npm test</code><ul><li>quietly</li><li>twice</li></ul></li><li id="s3">Done</li></ol>
<ol id="from3" start="3"><li>Third</li><li>Fourth</li></ol>
<ul id="bullets"><li>alpha<ol><li>one</li><li>two</li></ol></li><li>beta</li></ul>
<h2 id="head">Heading</h2>
<pre id="code">a  b
  c</pre>
<p id="last">The end</p>`

function Probe(): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const { onContextMenu, menu } = useCopyOnSelect(ref)
  return (
    <div>
      <div ref={ref} data-testid="region" onContextMenu={onContextMenu}>
        <div className="markdown" id="md" dangerouslySetInnerHTML={{ __html: HTML }} />
      </div>
      {menu}
    </div>
  )
}

let cleanup: (() => void) | null = null
afterEach(() => { cleanup?.(); cleanup = null; window.getSelection()?.removeAllRanges() })

async function mount(): Promise<void> {
  window.apiary = createFakeApiary()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<NotificationProvider><Probe /></NotificationProvider>)
  cleanup = () => { root.unmount(); host.remove() }
  await expect.poll(() => document.getElementById('md')).not.toBeNull()
}

function selectNodes(from: Node, to: Node | null = null): void {
  const range = document.createRange()
  if (to === null) range.selectNodeContents(from)
  else { range.setStartBefore(from); range.setEndAfter(to) }
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

const el = (id: string): HTMLElement => document.getElementById(id)!
const region = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="region"]')!
const textOf = (): string => selectionText(selectionFragmentWithin(region())!)

describe('selectionText', () => {
  it('numbers an ordered list and indents a nested bullet list', async () => {
    await mount()
    selectNodes(el('steps'))
    expect(textOf()).toBe('1. Open it\n2. Run npm test\n   - quietly\n   - twice\n3. Done')
  })

  it('keeps start=3', async () => {
    await mount()
    selectNodes(el('from3'))
    expect(textOf()).toBe('3. Third\n4. Fourth')
  })

  it('counts from item 2 when the selection starts there', async () => {
    await mount()
    selectNodes(el('s2'), el('s3'))
    expect(textOf()).toBe('2. Run npm test\n   - quietly\n   - twice\n3. Done')
  })

  it('bullets with a nested ordered list indented by two', async () => {
    await mount()
    selectNodes(el('bullets'))
    expect(textOf()).toBe('- alpha\n  1. one\n  2. two\n- beta')
  })

  it('separates paragraphs, headings and code blocks with blank lines, code as it is', async () => {
    await mount()
    selectNodes(el('intro'), el('last'))
    const text = textOf()
    expect(text.startsWith('Steps to take:\n\n1. Open it')).toBe(true)
    expect(text).toContain('\n\nHeading\n\na  b\n  c\n\nThe end')
  })
})

describe('copying in the region', () => {
  it('the copy event carries the numbered text and the selection as HTML', async () => {
    await mount()
    selectNodes(el('steps'))
    const data = new DataTransfer()
    region().dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }))
    expect(data.getData('text/plain')).toBe('1. Open it\n2. Run npm test\n   - quietly\n   - twice\n3. Done')
    expect(data.getData('text/html')).toContain('<ol')
  })

  it('a selection inside one paragraph is copied untouched', async () => {
    await mount()
    selectNodes(el('last'))
    const data = new DataTransfer()
    region().dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }))
    expect(data.getData('text/plain')).toBe('The end')
  })
})
