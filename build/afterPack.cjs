// electron-builder `afterPack` hook.
//
// Why this exists: electron-builder's asarUnpack step copies node-pty's
// prebuilt `spawn-helper` binary out of the asar so it can be exec'd at
// runtime, but that copy is a known way to lose the executable bit — the
// same problem `scripts/fix-node-pty-permissions.mjs` fixes after
// `npm install`. `postinstall` does not run at package time, so the packed
// output needs its own fix. This hook reuses that script's logic (via
// dynamic import of the shared `fixNodePtyPermissions` function) rather than
// duplicating the platform/prebuild-path logic here.
//
// electron-builder resolves node-pty inside the packed app at:
//   <appOutDir>/<contents>/app.asar.unpacked/node_modules/node-pty
// where <contents> is platform-specific (mac: Apiary.app/Contents/Resources,
// linux/win: resources).
//
// This hook must never fail the build: any problem is logged and swallowed.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron-builder loads this as CommonJS (.cjs); a static `import` isn't valid syntax here
const { existsSync } = require('node:fs')
// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron-builder loads this as CommonJS (.cjs); a static `import` isn't valid syntax here
const path = require('node:path')

module.exports = async function afterPack(context) {
  const log = (msg) => console.log(`[afterPack:fix-node-pty-permissions] ${msg}`)

  try {
    if (context.electronPlatformName === 'win32') {
      log('Windows uses conpty, not spawn-helper — nothing to do.')
      return
    }

    const { fixNodePtyPermissions } = await import(
      path.join(__dirname, '..', 'scripts', 'fix-node-pty-permissions.mjs')
    )

    const resourcesDir =
      context.electronPlatformName === 'darwin'
        ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
        : path.join(context.appOutDir, 'resources')

    const nodePtyDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'node-pty')

    if (!existsSync(nodePtyDir)) {
      log(`No unpacked node-pty found at ${nodePtyDir} — skipping.`)
      return
    }

    const { found, fixed } = fixNodePtyPermissions(nodePtyDir, log)
    log(`Checked packaged spawn-helper: found=${found} fixed=${fixed}`)
  } catch (err) {
    log(`Unexpected error, ignoring: ${err && err.message ? err.message : err}`)
  }
}
