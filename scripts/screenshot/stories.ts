/**
 * The conversations the README screenshot's chat panes open on: what a session file holds before
 * the chat starts. The turn that is still running (or waiting on a question) is played live by
 * `fake-claude-chat.mjs`; everything here is history, written as Claude Code writes it.
 */

type Block = Record<string, unknown>

/** Builds a session's transcript lines one message at a time, each a minute after the last. */
class Story {
  private n = 0
  private readonly start = Date.parse('2026-09-03T09:14:00.000Z')
  readonly lines: string[] = []

  constructor(private readonly sessionId: string, private readonly cwd: string, private readonly branch: string) {}

  private push(type: 'user' | 'assistant', content: string | Block[], seconds: number): void {
    this.n++
    this.lines.push(JSON.stringify({
      sessionId: this.sessionId, cwd: this.cwd, gitBranch: this.branch, isSidechain: false, version: '2.1.286',
      type, uuid: `${type[0]}-${String(this.n)}`, timestamp: new Date(this.start + seconds * 1000).toISOString(),
      message: { role: type, content },
    }))
  }

  private clock = 0
  user(text: string): this { this.push('user', text, this.clock += 40); return this }
  say(text: string): this { this.push('assistant', [{ type: 'text', text }], this.clock += 6); return this }
  think(text: string): this { this.push('assistant', [{ type: 'thinking', thinking: text, signature: 'x' }], this.clock += 4); return this }
  /** A tool call and its result, as two messages. A `failed` result draws the red dot. */
  tool(name: string, input: Record<string, unknown>, output: string, failed = false): this {
    const id = `toolu_${String(this.n + 1).padStart(4, '0')}`
    this.push('assistant', [{ type: 'tool_use', id, name, input }], this.clock += 3)
    this.push('user', [{ type: 'tool_result', tool_use_id: id, content: output, is_error: failed }], this.clock += 2)
    return this
  }
}

/** billing-api: the long run the large pane shows. The live turn (the full suite and lint) follows. */
export function invoiceStory(sessionId: string, cwd: string): string[] {
  return new Story(sessionId, cwd, 'fix/duplicate-invoice-emails')
    .user('Customers are getting two invoice emails whenever Stripe retries the webhook. Can you find out why?')
    .think('The retry hits the same endpoint with the same event id. Either the dedupe is missing or it runs after the email is sent. Look at the handler first.')
    .say('I’ll start with where the email is sent and the webhook handler that calls it.')
    .tool('Grep', { pattern: 'sendInvoiceEmail', path: 'src' },
      'src/webhooks/stripe.ts:48:    await sendInvoiceEmail(invoice)\nsrc/email/invoice.ts:12:export async function sendInvoiceEmail(invoice: Invoice): Promise<void> {\ntests/webhooks/stripe.test.ts:31:    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)')
    .tool('Read', { file_path: 'src/webhooks/stripe.ts', offset: 30, limit: 40 },
      '    30\texport async function handleInvoicePaid(event: Stripe.Event): Promise<void> {\n    31\t  const invoice = event.data.object as Stripe.Invoice\n    32\t  if (await seen.has(event.id)) return\n    33\t  const record = await invoices.upsert(toInvoice(invoice))\n    34\t  await sendInvoiceEmail(record)\n    35\t  await seen.add(event.id)\n    36\t}')
    .say('Found it. `handleInvoicePaid` checks `seen`, sends the email, and only then records the event id. Stripe retries after 10 s when the first delivery is slow, so the second request passes the check while the first is still sending.\n\nThe fix is to claim the event id **before** doing any work, atomically:\n\n```ts\nconst claimed = await seen.claim(event.id) // INSERT … ON CONFLICT DO NOTHING\nif (!claimed) return\n```')
    .tool('Edit', { file_path: 'src/webhooks/stripe.ts', old_string: '  if (await seen.has(event.id)) return', new_string: '  if (!(await seen.claim(event.id))) return' }, 'The file src/webhooks/stripe.ts has been updated.')
    .tool('Edit', { file_path: 'src/webhooks/seenEvents.ts', old_string: 'async has(id: string)', new_string: 'async claim(id: string)' }, 'The file src/webhooks/seenEvents.ts has been updated.')
    .tool('Bash', { command: 'npm test -- stripe', description: 'Run the webhook tests' },
      ' FAIL  tests/webhooks/stripe.test.ts\n  ● handleInvoicePaid › ignores a replayed event\n    TypeError: seen.has is not a function\n\nTests: 1 failed, 13 passed', true)
    .say('One test still mocks the old `has` method. Updating it to `claim`.')
    .tool('Edit', { file_path: 'tests/webhooks/stripe.test.ts', old_string: 'seen.has', new_string: 'seen.claim' }, 'The file tests/webhooks/stripe.test.ts has been updated.')
    .tool('Bash', { command: 'npm test -- stripe', description: 'Run the webhook tests' }, 'Tests: 14 passed, 14 total\nTime:  2.1 s')
    .user('Nice. Add a test for the concurrent case: two deliveries of the same event at once.')
    .think('Fire both handlers with Promise.all and assert the email mock was called exactly once. The in-memory fake needs claim() to be atomic too.')
    .tool('Write', { file_path: 'tests/webhooks/stripe.concurrent.test.ts', content: '…' }, 'File created successfully at: tests/webhooks/stripe.concurrent.test.ts')
    .tool('Bash', { command: 'npm test -- stripe.concurrent', description: 'Run the new test' }, 'Tests: 1 passed, 1 total')
    .say('Added `stripe.concurrent.test.ts`. It delivers the same event twice with `Promise.all` and asserts that exactly one email goes out. It fails on the old handler, which sent two.')
    .lines
}

/** data-pipeline: the session the terminal pane resumes; its transcript is what `claude --resume` would load. */
export function syncStory(sessionId: string, cwd: string): string[] {
  return new Story(sessionId, cwd, 'fix/nightly-sync-memory')
    .user('The nightly sync times out on big accounts. Why?')
    .tool('Read', { file_path: 'src/jobs/nightlySync.ts' }, '     1\texport async function nightlySync(): Promise<void> {\n     2\t  const accounts = await db.accounts.findAll()')
    .say('It loads every account into memory before batching, so one large tenant exhausts the heap.')
    .lines
}

/** web-app: a short conversation that ends with Claude asking where a preference should live. */
export function themeStory(sessionId: string, cwd: string): string[] {
  return new Story(sessionId, cwd, 'feat/dark-mode')
    .user('The settings page needs a dark mode toggle. Can you add one?')
    .tool('Grep', { pattern: 'prefers-color-scheme', path: 'src' },
      'src/theme/ThemeProvider.tsx:14:  const query = window.matchMedia(\'(prefers-color-scheme: dark)\')\nsrc/styles/tokens.css:62:@media (prefers-color-scheme: dark) {')
    .tool('Read', { file_path: 'src/theme/ThemeProvider.tsx' },
      '     1\timport { createContext, useEffect, useState } from \'react\'\n    …\n    14\t  const query = window.matchMedia(\'(prefers-color-scheme: dark)\')\n    15\t  const [theme, setTheme] = useState(query.matches ? \'dark\' : \'light\')')
    .say('The dark palette already exists in `src/styles/tokens.css`, and `ThemeProvider` follows the system setting. What is missing is a way to override it, and somewhere to remember the choice.')
    .lines
}
