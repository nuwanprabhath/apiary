import { describe, it, expect, vi } from 'vitest'
import { fireAndForget } from '../../src/main/log/fireAndForget'
import { log } from '../../src/main/log/logger'

describe('fireAndForget', () => {
  it('logs a rejection instead of letting it go unobserved', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    try {
      fireAndForget(Promise.reject(new Error('disk full')), 'watcher')
      // The rejection is handled asynchronously; give the microtask queue a turn.
      await new Promise((resolve) => setImmediate(resolve))
      expect(warn).toHaveBeenCalledWith('watcher', 'background task failed', { error: 'disk full' })
    } finally {
      warn.mockRestore()
    }
  })

  it('does nothing when the task succeeds', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    try {
      fireAndForget(Promise.resolve('ok'), 'watcher')
      await new Promise((resolve) => setImmediate(resolve))
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('stringifies a rejection that is not an Error', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    try {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exactly the non-Error shape fireAndForget has to handle
      fireAndForget(Promise.reject('plain string reason'), 'rescan')
      await new Promise((resolve) => setImmediate(resolve))
      expect(warn).toHaveBeenCalledWith('rescan', 'background task failed', { error: 'plain string reason' })
    } finally {
      warn.mockRestore()
    }
  })
})
