import { join } from 'node:path'

/**
 * The folder the bundled programs sit under, as `<root>/residents/mra`: `process.resourcesPath` in
 * a packaged app (`extraResources` in `electron-builder.yml` copies `resources/residents` to
 * `residents`), the repo's own `resources/` in development. The one place that knows; everything
 * else is handed the result by the container.
 */
export function resolveResourcesDir(o: { packaged: boolean; resourcesPath: string; appPath: string }): string {
  return o.packaged ? o.resourcesPath : join(o.appPath, 'resources')
}

/** The vendored MR desk program (`bin/mra`, `RESIDENT.md`) under a resources root. */
export const mraDirIn = (resourcesDir: string): string => join(resourcesDir, 'residents', 'mra')
