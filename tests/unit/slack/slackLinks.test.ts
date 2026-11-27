import { describe, expect, it } from 'vitest'
import type { RepoWebLocation } from '@shared/mentions/repoWebLocation'
import { linkReferences, markdownToSlack } from '../../../src/main/slack/slackText'

const REPO: RepoWebLocation = { forge: 'gitlab', webUrl: 'https://gitlab.example.com/team/app' }
const ISSUE = (n: number): string => `<https://gitlab.example.com/team/app/-/issues/${String(n)}|#${String(n)}>`

describe('linkReferences', () => {
  it('links bare issue and merge request references in prose', () => {
    expect(linkReferences('#3277 is written that way', REPO)).toBe(`${ISSUE(3277)} is written that way`)
    expect(linkReferences('#3274 to #3280 are children of the parent, #3273.', REPO))
      .toBe(`${ISSUE(3274)} to ${ISSUE(3280)} are children of the parent, ${ISSUE(3273)}.`)
    expect(linkReferences('see !1713', REPO)).toBe('see <https://gitlab.example.com/team/app/-/merge_requests/1713|!1713>')
    expect(linkReferences('in other/proj#5 and other/proj!6', REPO)).toBe(
      'in <https://gitlab.example.com/other/proj/-/issues/5|other/proj#5> and <https://gitlab.example.com/other/proj/-/merge_requests/6|other/proj!6>',
    )
  })

  it('leaves code, existing links and URLs as they are, and never links twice', () => {
    const md = '- [#3273](https://gitlab.example.com/team/app/-/issues/3273) (parent), `#12` and #14\n```\n#13 in a fence\n```\nhttps://x.test/a#15 <#C1|general>'
    const once = linkReferences(markdownToSlack(md), REPO)
    expect(once).toBe(
      `- <https://gitlab.example.com/team/app/-/issues/3273|#3273> (parent), \`#12\` and ${ISSUE(14)}\n\`\`\`\n#13 in a fence\n\`\`\`\nhttps://x.test/a#15 <#C1|general>`,
    )
    expect(linkReferences(once, REPO)).toBe(once)
    expect(linkReferences('[#16](https://u.test)', REPO)).toBe('[#16](https://u.test)')
  })

  it('leaves the text unchanged with no repository', () => {
    expect(linkReferences('#3277 and !12', null)).toBe('#3277 and !12')
  })
})
