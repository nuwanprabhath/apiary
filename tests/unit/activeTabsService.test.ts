import { describe, it, expect, vi } from 'vitest'
import { ActiveTabsService, type ActiveTabsDeps } from '../../src/main/terminals/activeTabsService'
import { emptyChatState, type ChatState } from '@shared/domain/chat'
import { asPtyId, asSessionId } from '@shared/domain/ids'
import type { OpenTab } from '@shared/domain/tabs'

const NOW = 1_000_000
const A = asSessionId('11111111-1111-4111-8111-111111111111')

const terminalTab = (key: string): OpenTab => ({ windowNumber: 1, key, view: 'terminal', ptyId: asPtyId(key), label: null })
const transcriptTab = (key: string): OpenTab => ({ windowNumber: 1, key, view: 'transcript', ptyId: null, label: null })

interface World {
  tabs?: OpenTab[]
  alive?: boolean
  screen?: string
  lastOutputAt?: number
  chats?: ChatState[]
  tasks?: number
}

function activeTabs(world: World) {
  const runningBackgroundTasks = vi.fn(async () => world.tasks ?? 0)
  const deps: ActiveTabsDeps = {
    tabs: { list: () => world.tabs ?? [] },
    pty: {
      has: () => world.alive ?? true,
      screen: () => world.screen ?? '',
      lastOutputAt: () => world.lastOutputAt ?? 0,
    },
    chats: { state: (id) => world.chats?.find((c) => c.sessionId === id) ?? null },
    transcripts: { runningBackgroundTasks },
    now: () => NOW,
  }
  const list = () => new ActiveTabsService(deps).list()
  return { list, runningBackgroundTasks }
}

describe('ActiveTabsService', () => {
  it('lists each tab with its window, key, view and label, and no pty id', async () => {
    const { list } = activeTabs({
      tabs: [{ windowNumber: 2, key: 'new:pending', view: 'transcript', ptyId: null, label: 'Fork of billing' }],
    })
    expect(await list()).toEqual([
      { windowNumber: 2, key: 'new:pending', view: 'transcript', label: 'Fork of billing', status: 'stopped' },
    ])
  })

  it('a terminal takes its status from its pty output', async () => {
    const { list } = activeTabs({ tabs: [terminalTab('s1')], lastOutputAt: NOW - 100 })
    expect((await list()).map((t) => t.status)).toEqual(['running'])
  })

  it('a dead pty is stopped even while a background task is recorded, and its file is not read', async () => {
    const { list, runningBackgroundTasks } = activeTabs({ tabs: [terminalTab('s1')], alive: false, tasks: 1 })
    expect((await list()).map((t) => t.status)).toEqual(['stopped'])
    expect(runningBackgroundTasks).not.toHaveBeenCalled()
  })

  it('an idle terminal with a background task is running', async () => {
    const { list } = activeTabs({ tabs: [terminalTab('s1')], tasks: 1 })
    expect((await list()).map((t) => t.status)).toEqual(['running'])
  })

  it('a terminal waiting on a prompt stays waiting with a background task', async () => {
    const { list } = activeTabs({
      tabs: [terminalTab('s1')],
      screen: 'Do you want to proceed?\n❯ 1. Yes\n  2. No',
      tasks: 1,
    })
    expect((await list()).map((t) => t.status)).toEqual(['waiting'])
  })

  it('a chat tab takes its status from its chat', async () => {
    const { list } = activeTabs({ tabs: [transcriptTab(A)], chats: [{ ...emptyChatState(A), status: 'busy' }] })
    expect((await list()).map((t) => t.status)).toEqual(['running'])
  })

  it('an idle chat with a background task is running, from the chat, without reading the file', async () => {
    const chat: ChatState = {
      ...emptyChatState(A), status: 'idle', backgroundTasks: [{ taskId: 'b1', description: 'Sleep' }],
    }
    const { list, runningBackgroundTasks } = activeTabs({ tabs: [transcriptTab(A)], chats: [chat] })
    expect((await list()).map((t) => t.status)).toEqual(['running'])
    expect(runningBackgroundTasks).not.toHaveBeenCalled()
  })

  it('a transcript tab with no chat and no terminal is stopped', async () => {
    const { list } = activeTabs({ tabs: [transcriptTab('s1')] })
    expect((await list()).map((t) => t.status)).toEqual(['stopped'])
  })
})
