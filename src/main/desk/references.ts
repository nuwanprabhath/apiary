import { asSessionId } from '@shared/domain/ids'
import { MR_DESK_KIND, type ResidentConfig } from '@shared/domain/residents'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { gitlabProjectWebLocation } from '@shared/mentions/gitlabProject'
import type { RepoWebLocation } from '@shared/mentions/repoWebLocation'
import type { DeskParts, DeskPiece, DeskRepos } from './deskPiece'

/**
 * The repository a task's `#12` resolves against: the one GitLab repository of its sessions, else
 * the MR desk's project (two repositories would make a bare number ambiguous), else none.
 */
export async function taskRepo(sessions: readonly string[], repos: DeskRepos): Promise<RepoWebLocation | null> {
  const found = await Promise.all(sessions.map((id) =>
    ignoreErrorsAsync(() => repos.ofSession(asSessionId(id)), 'a session that is gone has no repository')))
  const gitlab = new Map<string, RepoWebLocation>()
  for (const repo of found) if (repo?.forge === 'gitlab') gitlab.set(repo.webUrl, repo)
  const [only] = gitlab.values()
  return gitlab.size === 1 && only !== undefined ? only : repos.mrDesk()
}

/** Links the references in every post the desk makes to the repository of the task it is about. */
export const references: DeskPiece = ({ bridge, repos }: DeskParts) =>
  bridge.linkReferences((thread) => taskRepo(thread === null ? [] : bridge.tasks.get(thread)?.sessions ?? [], repos))

/** The configured project of the first MR desk that is on (else of any) whose project reads as one. */
export function mrDeskRepo(configs: readonly ResidentConfig[]): RepoWebLocation | null {
  const desks = configs.filter((c) => c.kind === MR_DESK_KIND).sort((a, b) => Number(b.enabled) - Number(a.enabled))
  for (const desk of desks) {
    const repo = gitlabProjectWebLocation(desk.options.project ?? '')
    if (repo !== null) return repo
  }
  return null
}
