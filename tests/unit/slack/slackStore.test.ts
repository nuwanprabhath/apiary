import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SlackBridge } from '../../../src/main/slack/slackBridge'
import { NO_KEYCHAIN, SlackStore } from '../../../src/main/slack/slackStore'
import { fakeSlack } from '../../fixtures/fakeSlack'
import { memoryCipher } from '../../fixtures/memoryCipher'

const file = (): string => join(mkdtempSync(join(tmpdir(), 'apiary-slack-')), 'slack.json')

describe('SlackStore', () => {
  it('the token is written encrypted and never returned in a status', async () => {
    const path = file()
    const store = new SlackStore(path, memoryCipher())
    const bridge = new SlackBridge({ store, api: fakeSlack() })
    const status = await bridge.configure({ token: 'xoxb-plain-secret', channel: 'work', ownerId: 'UOWNER001' })
    const onDisk = readFileSync(path, 'utf8')
    expect(onDisk).not.toContain('xoxb-plain-secret')
    expect(onDisk).toContain('enc:')
    expect(JSON.stringify(status)).not.toContain('plain-secret')
    expect(status.hasToken).toBe(true)
    expect(await new SlackStore(path, memoryCipher()).token()).toBe('xoxb-plain-secret')
  })

  it('with no keychain a token is refused', async () => {
    const path = file()
    const store = new SlackStore(path, memoryCipher({ available: false }))
    await expect(store.saveToken('xoxb-x')).rejects.toThrow(NO_KEYCHAIN)
    const bridge = new SlackBridge({ store, api: fakeSlack() })
    await expect(bridge.configure({ token: 'xoxb-x' })).rejects.toThrow('no keychain')
    expect(store.state.token).toBeNull()
    expect(bridge.status().canStoreToken).toBe(false)
  })

  it('a damaged task entry is dropped and the rest kept', () => {
    const path = file()
    const good = { thread: '1.1', text: 'ok', startedAt: 5, state: 'open', sessions: ['s'], residents: [], autoAllow: [], lastReplyTs: null }
    writeFileSync(path, JSON.stringify({ version: 1, enabled: true, tasks: [good, { thread: 7 }, null, { ...good, thread: '2.2', state: 'weird' }], awaiting: [{ ts: '1.1' }] }))
    const state = new SlackStore(path, null).state
    expect(state.enabled).toBe(true)
    expect(state.tasks.map((t) => t.thread)).toEqual(['1.1'])
    expect(state.awaiting).toEqual([])
  })
})
