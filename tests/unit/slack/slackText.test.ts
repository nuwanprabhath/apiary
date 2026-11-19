import { describe, expect, it } from 'vitest'
import { markdownToSlack, slackToPlain, splitForSlack } from '../../../src/main/slack/slackText'

describe('slackText', () => {
  it("reads Slack's links, mentions and entities as plain text", () => {
    expect(slackToPlain('hi <@U1> see <https://x.test|the page> and <https://y.test> &amp; &lt;b&gt;'))
      .toBe('hi @U1 see the page (https://x.test) and https://y.test & <b>')
  })

  it('writes Markdown bold, links and headings as mrkdwn', () => {
    expect(markdownToSlack('# Title\nsome **bold** and [t](https://u.test)\n```\n**keep** [a](b)\n```')).toBe(
      '*Title*\nsome *bold* and <https://u.test|t>\n```\n**keep** [a](b)\n```',
    )
  })

  it('splits a long text on paragraph breaks, never inside a code fence', () => {
    const fence = `\`\`\`\n${'code line\n\n'.repeat(100)}\`\`\``
    const text = `${'a'.repeat(900)}\n\n${'b'.repeat(900)}\n\n${fence}\n\n${'c'.repeat(900)}`
    const pieces = splitForSlack(text, 1500)
    expect(pieces.every((p) => p.length <= 1500)).toBe(true)
    expect(pieces.join('\n\n')).toBe(text)
    expect(pieces[0]).toBe(`${'a'.repeat(900)}`)
    expect(pieces.some((p) => p === fence)).toBe(true)
    expect(splitForSlack('short')).toEqual(['short'])
  })
})
