import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AppService } from '../../../src/main/appService'
import { SearchClient } from '../../../src/main/search/searchClient'
import { createServiceFixture, teardownServiceFixture } from './setup'

let home: string
let workdir: string
let service: AppService

beforeEach(() => {
  ;({ home, workdir, service } = createServiceFixture())
})
afterEach(async () => {
  await teardownServiceFixture({ home, workdir, service })
})
describe('AppService.dispose() (MAIN-20)', () => {
  it('closes the search client, so its worker thread and SQLite handle do not outlive the app', async () => {
    // searchSessions() lazily creates the SearchClient on first use (there is no bundled worker
    // beside the source in a test run, so it falls back to searching in-process — see the comment
    // on searchSessions — but the client object itself still exists and needs closing).
    await service.searchSessions('anything')
    const close = vi.spyOn(SearchClient.prototype, 'close')
    try {
      await service.dispose()
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      close.mockRestore()
    }
  })
})
