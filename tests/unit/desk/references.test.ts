import { describe, expect, it } from 'vitest'
import { MR_DESK_KIND, REGENT_KIND, type ResidentConfig } from '@shared/domain/residents'
import type { RepoWebLocation } from '@shared/mentions/repoWebLocation'
import type { DeskRepos } from '../../../src/main/desk/deskPiece'
import { mrDeskRepo, taskRepo } from '../../../src/main/desk/references'
import { kindOf, newResident } from '../../../src/main/residents/kinds'

const APP: RepoWebLocation = { forge: 'gitlab', webUrl: 'https://gitlab.test/team/app' }
const API: RepoWebLocation = { forge: 'gitlab', webUrl: 'https://gitlab.test/team/api' }
const HUB: RepoWebLocation = { forge: 'github', webUrl: 'https://github.com/o/r' }
const DESK: RepoWebLocation = { forge: 'gitlab', webUrl: 'https://gitlab.com/g/p' }

const repos = (bySession: Record<string, RepoWebLocation | null>, desk: RepoWebLocation | null = DESK): DeskRepos => ({
  ofSession: async (id) => { if (!(id in bySession)) throw new Error('no such session'); return bySession[id] ?? null },
  mrDesk: () => desk,
})

describe("the desk's reference repository", () => {
  it("is the one GitLab repository the task's sessions are in", async () => {
    expect(await taskRepo(['s1', 's2'], repos({ s1: APP, s2: { ...APP } }))).toEqual(APP)
    expect(await taskRepo(['s1', 's2', 'gone'], repos({ s1: APP, s2: HUB }))).toEqual(APP)
  })

  it("falls back to the MR desk's project with none or several, and to nothing without an MR desk", async () => {
    expect(await taskRepo([], repos({}))).toEqual(DESK)
    expect(await taskRepo(['s1', 's2'], repos({ s1: APP, s2: API }))).toEqual(DESK)
    expect(await taskRepo(['s1'], repos({ s1: null }, null))).toBeNull()
  })

  it("reads the MR desk's configured project, an enabled desk first", () => {
    const desk = (project: string, enabled: boolean): ResidentConfig => ({ ...newResident(kindOf(MR_DESK_KIND), new Set()), enabled, options: { project } })
    const regent = newResident(kindOf(REGENT_KIND), new Set())
    expect(mrDeskRepo([regent])).toBeNull()
    expect(mrDeskRepo([regent, desk('not a project', true)])).toBeNull()
    expect(mrDeskRepo([desk('old/one', false), desk('https://gitlab.test/team/app/-/merge_requests', true)])).toEqual(APP)
  })
})
