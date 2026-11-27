import { describe, expect, it } from 'vitest'
import { readTerminalNotice, sameNotice } from '@shared/terminalNotice'

const SCREEN = [
  '● All four CodeRabbit comments are valid. I\'m applying the fixes now.',
  '',
  '● Running 1 shell command…',
  '',
  '✻ Slithering… (42s · ↓ 3.5k tokens)',
  '  ⎿  Tip: Use ctrl+v to paste images from your clipboard',
  '                                                                                [-]',
  '✦ Heads up · The new build checkbox will only appear for branches that already contain the change, so the',
  '  hotfix branch in your screenshot won\'t show it.',
  '  1: Learn more   2: Knew this already   0: Dismiss',
  '────────────────────────────────────────────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────────────────────────────────────────────',
  '  Opus 5.5 (high) | 5h: 35% | ctx: 90%',
].join('\n')

describe('reading the heads-up note off a Claude Code screen', () => {
  it('reads its tag, its wrapped text as one line, and its answers', () => {
    expect(readTerminalNotice(SCREEN)).toEqual({
      tag: 'Heads up',
      text: 'The new build checkbox will only appear for branches that already contain the change, so the hotfix branch in your screenshot won\'t show it.',
      choices: [
        { key: '1', label: 'Learn more' },
        { key: '2', label: 'Knew this already' },
        { key: '0', label: 'Dismiss' },
      ],
    })
  })

  it('finds it near the top of a tall screen, under rows of nothing', () => {
    expect(readTerminalNotice(SCREEN + '\n'.repeat(40))?.tag).toBe('Heads up')
  })

  it('reads the "You should know" form too', () => {
    const notice = readTerminalNotice('✦ You should know · The deploy skips tests.\n  1: Learn more   0: Dismiss\n❯ ')
    expect(notice?.tag).toBe('You should know')
    expect(notice?.text).toBe('The deploy skips tests.')
  })

  it('is not a reply of Claude\'s that happens to start "Heads up · "', () => {
    expect(readTerminalNotice('● Heads up · the deploy key expires Friday.\n\n❯ ')).toBeNull()
  })

  it('is null when no note is showing', () => {
    expect(readTerminalNotice(SCREEN.replace(/✦ Heads up · /, ''))).toBeNull()
    expect(readTerminalNotice('')).toBeNull()
  })

  it('compares two reads by what they show', () => {
    const a = readTerminalNotice(SCREEN)
    expect(sameNotice(a, readTerminalNotice(SCREEN))).toBe(true)
    expect(sameNotice(a, null)).toBe(false)
    expect(sameNotice(undefined, null)).toBe(true)
  })
})
