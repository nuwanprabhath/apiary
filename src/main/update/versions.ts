/**
 * Version arithmetic for the updater, kept pure and away from Electron so the rules that decide
 * whether to bother the user are testable without packaging an app.
 *
 * Apiary's tags are plain semver (`v1.8.2`), with the occasional pre-release suffix
 * (`v1.9.0-beta.1`). Nothing here needs the full semver range grammar — only "is this one newer
 * than that one", which is small enough to own outright rather than take a dependency for.
 */

export interface Version {
  major: number
  minor: number
  patch: number
  /** The dot-separated identifiers after `-`, empty for a stable release. */
  prerelease: (string | number)[]
}

/** Parses `1.9.0`, `v1.9.0` or `1.9.0-beta.2`. Returns null for anything that isn't one. */
export function parseVersion(raw: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw.trim())
  if (match === null) return null
  const prerelease = match[4] === undefined
    ? []
    : match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  }
}

export function isPrerelease(raw: string): boolean {
  return (parseVersion(raw)?.prerelease.length ?? 0) > 0
}

/**
 * Compares two versions: negative if `a` is older, positive if newer, 0 if the same.
 *
 * Pre-releases sort *before* the release they lead to (1.9.0-beta.1 < 1.9.0), which is the rule
 * that stops someone on a beta being told to "update" to the stable version they are ahead of and
 * then handed an older build.
 */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch

  // A version with no pre-release part is the finished one, and therefore the newer.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const left = a.prerelease[i]
    const right = b.prerelease[i]
    // A shorter run of identifiers sorts first: beta.1 precedes beta.1.1.
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    // Numeric identifiers always sort below alphanumeric ones, per semver.
    if (typeof left === 'number' && typeof right === 'number') return left - right
    if (typeof left === 'number') return -1
    if (typeof right === 'number') return 1
    return left < right ? -1 : 1
  }
  return 0
}

/** Whether `candidate` is a version worth moving to from `current`. */
export function isNewer(current: string, candidate: string): boolean {
  const from = parseVersion(current)
  const to = parseVersion(candidate)
  if (from === null || to === null) return false
  return compareVersions(to, from) > 0
}

export interface OfferInput {
  /** The running version. */
  current: string
  /** The newest version the feed knows about. */
  candidate: string
  /** A version the user chose to skip, if any. */
  skipped: string | null
  /** Whether the user has opted into pre-releases. */
  allowPrerelease: boolean
}

/**
 * Whether an available version should actually be put in front of the user.
 *
 * Three things have to hold, and each of them is a bug someone has shipped before: it has to be
 * newer than what is running (not merely *different* — a downgrade after a pulled release is the
 * classic one); it has to be a stable release unless pre-releases were asked for, *unless* the
 * user is already running a pre-release, in which case they are plainly on that track and stopping
 * their updates would strand them; and it must not be the exact version they already dismissed.
 */
export function shouldOffer({ current, candidate, skipped, allowPrerelease }: OfferInput): boolean {
  if (!isNewer(current, candidate)) return false
  if (isPrerelease(candidate) && !allowPrerelease && !isPrerelease(current)) return false
  // Skipping is per-version, not permanent: the next release is offered as normal.
  if (skipped !== null && parseVersion(skipped) !== null && parseVersion(candidate) !== null
    && compareVersions(parseVersion(candidate)!, parseVersion(skipped)!) === 0) return false
  return true
}
