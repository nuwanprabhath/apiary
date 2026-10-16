/**
 * What a forked session is called. Claude titles a fork from the same conversation as the
 * original, so without the prefix the two rows would look identical. Forking a fork nests the
 * prefix, so a chain is distinguishable from siblings.
 */
export function forkLabel(title: string): string {
  return `fork: ${title}`
}
