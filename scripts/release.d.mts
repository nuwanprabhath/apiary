/** Types for `release.mjs`, so its unit test can import it. */
export function versionsToAnnotate(changelog: string, releasedTags: string[]): { version: string; shippedIn: string }[]
export function tagsWithoutRelease(tags: string[], releaseTags: string[]): string[]
export function isTransientDownloadFailure(log: string): boolean
export function missingAssets(names: string[]): string[]
export function changelogHeadings(text: string): { version: string; annotated: boolean }[]
export function awaitRun<T>(list: () => T[], wait: () => Promise<void>, tries: number): Promise<T | null>
export function waitForCi(sha: string, list: () => { databaseId: number; status: string; conclusion: string }[], watch: (id: number) => void, wait?: () => Promise<void>): Promise<string | null>
export function outstanding(o: { issues: { number: number; title: string }[]; prs: { number: number; title: string }[]; due: string[] }): string[]
