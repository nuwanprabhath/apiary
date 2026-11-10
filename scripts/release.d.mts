/** Types for `release.mjs`, so its unit test can import it. */
export function versionsToAnnotate(changelog: string, releasedTags: string[]): { version: string; shippedIn: string }[]
export function tagsWithoutRelease(tags: string[], releaseTags: string[]): string[]
export function isTransientDownloadFailure(log: string): boolean
export function missingAssets(names: string[]): string[]
export function changelogHeadings(text: string): { version: string; annotated: boolean }[]
