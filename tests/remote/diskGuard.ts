/** The image is about 5 GB and a build needs scratch space on top; below this the Docker disk fills. */
export const MIN_FREE_GB = 15 // GiB, as `df -k` divided by 1024²

/** Free kilobytes from `df -k <path>` output (the Available column of its one data row), or undefined. */
export function parseDfFreeKb(output: string): number | undefined {
  const row = output.trim().split('\n').at(-1)?.trim().split(/\s+/)
  const kb = row === undefined ? NaN : Number(row[3])
  return Number.isFinite(kb) ? kb : undefined
}

/**
 * macOS: the home volume's free space as Finder counts it ("available for important usage"), in
 * bytes. That includes purgeable space (local snapshots, caches), which macOS frees as soon as a
 * write needs it; `df` leaves it out and once read 14.7 GiB against Finder's 59.8 GB.
 */
export const MAC_FREE_BYTES_JXA = 'ObjC.import("Foundation"); const k = "NSURLVolumeAvailableCapacityForImportantUsageKey"; '
  + 'String($.NSURL.fileURLWithPath($.NSHomeDirectory()).resourceValuesForKeysError($([k]), null).objectForKey(k).js)'

/** Kilobytes from the byte count `MAC_FREE_BYTES_JXA` prints, or undefined for anything else. */
export function parseFreeBytesAsKb(output: string): number | undefined {
  const bytes = Number(output.trim())
  return output.trim() !== '' && Number.isFinite(bytes) && bytes >= 0 ? bytes / 1024 : undefined
}

/** The refusal message when the disk is too full to build the test bed image, else undefined. */
export function lowDiskMessage(freeKb: number): string | undefined {
  const freeGb = freeKb / 1024 / 1024
  if (freeGb >= MIN_FREE_GB) return undefined
  return `Refusing to build the remote test bed image: ${freeGb.toFixed(1)} GiB free, need at least ${MIN_FREE_GB} GiB (the image is about 5 GB). Finder counts decimal GB, about 7% more.`
}
