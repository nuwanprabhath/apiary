import { describe, expect, it } from 'vitest'
import { findMentions, type MentionContext } from '@shared/mentions/kinds'
import { parseRepoWebLocation } from '@shared/mentions/repoWebLocation'
import { gitlabProjectWebLocation } from '@shared/mentions/gitlabProject'

const GITLAB: MentionContext = { repo: { forge: 'gitlab', webUrl: 'https://gitlab.com/group/project' }, files: false }
const GITHUB: MentionContext = { repo: { forge: 'github', webUrl: 'https://github.com/owner/repo' }, files: false }
const NONE: MentionContext = { repo: null, files: false }

const links = (text: string, context: MentionContext): Array<[string, string]> =>
  findMentions(text, context).flatMap((m) => (m.target.kind === 'link' ? [[m.text, m.target.href] as [string, string]] : []))

describe('remote URLs as a repository web page', () => {
  it.each([
    ['git@gitlab.com:group/project.git', 'gitlab', 'https://gitlab.com/group/project'],
    ['https://gitlab.com/group/sub/project.git', 'gitlab', 'https://gitlab.com/group/sub/project'],
    ['ssh://git@gitlab.example.org:2222/team/app', 'gitlab', 'https://gitlab.example.org/team/app'],
    ['git@github.com:owner/repo.git', 'github', 'https://github.com/owner/repo'],
    ['https://github.com/owner/repo', 'github', 'https://github.com/owner/repo'],
    ['git@git.corp.example:a/b/c.git', 'gitlab', 'https://git.corp.example/a/b/c'],
  ])('%s is %s at %s', (remote, forge, webUrl) => {
    expect(parseRepoWebLocation(remote)).toEqual({ forge, webUrl })
  })

  it.each(['https://bitbucket.org/team/repo.git', '/tmp/origin.git', '../origin', 'file:///tmp/origin', '', 'git@gitlab.com:project'])(
    'knows no page for %j', (remote) => { expect(parseRepoWebLocation(remote)).toBeNull() },
  )

  it('reads the MR desk project as a GitLab page, gitlab.com when no host is given', () => {
    expect(gitlabProjectWebLocation('group/project')).toEqual({ forge: 'gitlab', webUrl: 'https://gitlab.com/group/project' })
    expect(gitlabProjectWebLocation('https://gl.example.com/a/b/-/issues')).toEqual({ forge: 'gitlab', webUrl: 'https://gl.example.com/a/b' })
    expect(gitlabProjectWebLocation('nonsense')).toBeNull()
  })
})

describe('reference mentions', () => {
  it('links issues and merge requests in a GitLab project', () => {
    expect(links('Add it to dev under #3202. Port !1713 plus that.', GITLAB)).toEqual([
      ['#3202', 'https://gitlab.com/group/project/-/issues/3202'],
      ['!1713', 'https://gitlab.com/group/project/-/merge_requests/1713'],
    ])
  })

  it('links another project on the same host, preferring the longer match', () => {
    expect(links('see other/thing!12 and other/thing#5', GITLAB)).toEqual([
      ['other/thing!12', 'https://gitlab.com/other/thing/-/merge_requests/12'],
      ['other/thing#5', 'https://gitlab.com/other/thing/-/issues/5'],
    ])
  })

  it('links GitHub refs to /issues/N, and owner/repo#N; never a !N', () => {
    expect(links('fixes #42 and acme/tools#7, not !3', GITHUB)).toEqual([
      ['#42', 'https://github.com/owner/repo/issues/42'],
      ['acme/tools#7', 'https://github.com/acme/tools/issues/7'],
    ])
    expect(links('a/b/c#7', GITHUB)).toEqual([])
  })

  it.each([
    ['inside a word', 'abc#12 x!34'],
    ['a heading anchor', 'see #install and #step-2'],
    ['a colour', 'color: #123456 and #fff and #a1b2c3'],
    ['a URL', 'https://gitlab.com/g/p/-/issues/12#note_3 and https://x.io/?q=!12 and https://x.io/#12'],
    ['a path', 'src/#12/a and ./#3'],
    ['glued after', '#12abc and !34-x and #5.x'],
  ])('refuses a reference %s', (_why, text) => {
    expect(links(text, GITLAB)).toEqual([])
  })

  it('links nothing without a repository', () => {
    expect(links('#12 and !34', NONE)).toEqual([])
  })

  it('keeps file mentions as files, only when files can be opened', () => {
    expect(findMentions('open src/app.ts and #3', { ...GITLAB, files: true }).map((m) => [m.kind, m.text])).toEqual([
      ['file', 'src/app.ts'], ['gitlab-issue', '#3'],
    ])
    expect(findMentions('open src/app.ts', GITLAB)).toEqual([])
  })
})
