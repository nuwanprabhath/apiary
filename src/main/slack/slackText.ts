/** Slack's message text to plain text, Markdown to Slack's mrkdwn, and long text into posts. Pure. */

/** Slack's `<@U1>`, `<https://x|label>`, `<https://x>` and `&amp; &lt; &gt;` as plain text. */
export function slackToPlain(text: string): string {
  return text
    .replace(/<([^<>]+)>/g, (_all, inner: string) => {
      if (inner.startsWith('@') || inner.startsWith('#')) {
        const [id, label] = inner.split('|')
        return label !== undefined && inner.startsWith('#') ? `#${label}` : (id ?? inner)
      }
      const bar = inner.indexOf('|')
      if (bar === -1) return inner
      const label = inner.slice(bar + 1)
      return label === '' ? inner.slice(0, bar) : `${label} (${inner.slice(0, bar)})`
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Markdown as mrkdwn: bold, links and headings; code fences and inline code are left as written. */
export function markdownToSlack(markdown: string): string {
  const out: string[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) { inFence = !inFence; out.push(line); continue }
    out.push(inFence ? line : convertLine(line))
  }
  return out.join('\n')
}

function convertLine(line: string): string {
  const heading = /^#{1,6}\s+(.*)$/.exec(line)
  const body = heading === null ? line : `**${(heading[1] ?? '').trim()}**`
  // Inline code spans stay as they are: split on them and convert the text between.
  return body.split(/(`[^`]*`)/).map((part, i) => (i % 2 === 1 ? part : convertInline(part))).join('')
}

function convertInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<$2|$1>')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
}

export const SLACK_POST_LIMIT = 3500

/** Splits `text` into pieces of at most `limit` characters on blank lines, else line breaks, never inside a code fence unless the fence alone is too long. */
export function splitForSlack(text: string, limit = SLACK_POST_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const blocks = fencedBlocks(text)
  const pieces: string[] = []
  let current = ''
  const flush = (): void => { if (current !== '') { pieces.push(current); current = '' } }
  for (const block of blocks) {
    const joined = current === '' ? block : `${current}\n\n${block}`
    if (joined.length <= limit) { current = joined; continue }
    flush()
    if (block.length <= limit) { current = block; continue }
    for (const part of hardSplit(block, limit)) pieces.push(part)
  }
  flush()
  return pieces
}

/** Paragraphs (blank-line separated); a code fence is one block however many blank lines it holds. */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let inFence = false
  const end = (): void => { if (current.length > 0) blocks.push(current.join('\n')); current = [] }
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence
    if (line.trim() === '' && !inFence) { end(); continue }
    current.push(line)
  }
  end()
  return blocks
}

/** A block over the limit: on line breaks, and a single over-long line by length. */
function hardSplit(block: string, limit: number): string[] {
  const pieces: string[] = []
  let current = ''
  for (const line of block.split('\n')) {
    if (line.length > limit) {
      if (current !== '') { pieces.push(current); current = '' }
      for (let i = 0; i < line.length; i += limit) pieces.push(line.slice(i, i + limit))
      continue
    }
    const joined = current === '' ? line : `${current}\n${line}`
    if (joined.length > limit) { pieces.push(current); current = line } else current = joined
  }
  if (current !== '') pieces.push(current)
  return pieces
}
