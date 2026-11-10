export interface PushedCommit {
  sha: string
  authorEmail: string
  committerEmail: string
  message: string
}
export function pushedCommitProblems(commits: PushedCommit[]): string[]
export function pushedRanges(stdin: string): string[][]
