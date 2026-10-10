import { trackActivity } from './activityStore'

/** The activity key of a pull of `branch`, so its menu item and toolbar button can tell it runs. */
export const pullKey = (branch: string): string => `pull:${branch}`

const plural = (n: number): string => `${String(n)} commit${n === 1 ? '' : 's'}`

/** Shows a pull of `branch` in the status bar; returns `work` unchanged. */
export function trackPull<T extends { commits: number }>(branch: string, work: Promise<T>): Promise<T> {
  return trackActivity(
    {
      key: pullKey(branch),
      running: `Pulling ${branch}…`,
      done: ({ commits }) => (commits > 0 ? `Pulled ${branch} (${plural(commits)})` : `Pulled ${branch}`),
      failed: `Pull failed: ${branch}`,
    },
    work,
  )
}

/** Shows a push of `branch` in the status bar; returns `work` unchanged. */
export function trackPush<T>(branch: string, work: Promise<T>): Promise<T> {
  return trackActivity(
    { key: `push:${branch}`, running: `Pushing ${branch}…`, done: () => `Pushed ${branch}`, failed: `Push failed: ${branch}` },
    work,
  )
}
