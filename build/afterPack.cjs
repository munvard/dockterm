const path = require('node:path')
const fs = require('node:fs')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

/**
 * node-pty spawns the shell on macOS/Linux via a small `spawn-helper` binary.
 * Packing it into app.asar.unpacked (and some npm extractions) can drop its
 * executable permission bit, which makes node-pty fail with "posix_spawnp
 * failed". Restore +x on every spawn-helper before electron-builder code-signs
 * the app, so the signed/notarized binary is runnable. Runs before signing.
 */
function fixSpawnHelperPerms(root) {
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      fixSpawnHelperPerms(full)
    } else if (entry.name === 'spawn-helper') {
      try {
        fs.chmodSync(full, 0o755)
        console.log('afterPack: restored +x on', full)
      } catch (err) {
        console.warn('afterPack: could not chmod', full, err.message)
      }
    }
  }
}

/**
 * Flips Electron fuses at package time to shrink the runtime attack surface:
 * the packaged binary can no longer be coerced into running as plain Node,
 * honoring NODE_OPTIONS, opening the inspector, or loading app code from outside
 * the asar archive.
 */
exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context
  const appName = packager.appInfo.productFilename

  let electronBinary
  if (electronPlatformName === 'darwin') {
    electronBinary = path.join(appOutDir, `${appName}.app`, 'Contents', 'MacOS', appName)
  } else if (electronPlatformName === 'win32') {
    electronBinary = path.join(appOutDir, `${appName}.exe`)
  } else {
    electronBinary = path.join(appOutDir, appName.toLowerCase())
  }

  // Restore the node-pty spawn-helper executable bit (macOS & Linux) before signing.
  if (electronPlatformName === 'darwin') {
    fixSpawnHelperPerms(
      path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources', 'app.asar.unpacked')
    )
  } else if (electronPlatformName === 'linux') {
    fixSpawnHelperPerms(path.join(appOutDir, 'resources', 'app.asar.unpacked'))
  }

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // file:// is never used to load app content (production loads over the
    // custom app:// scheme; see protocol.ts), so it doesn't need the extra
    // privileges Electron grants it by default.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
    // NOT flipping EnableEmbeddedAsarIntegrityValidation here: that fuse
    // requires electron-builder to also EMBED a matching integrity header in
    // the asar at package time (its own "asarIntegrity" support), which this
    // afterPack-driven flipFuses call does not do. Turning the fuse on
    // without that pairing makes Electron refuse to load the asar at all —
    // i.e. the packaged app would fail to launch for EVERY user, signed or
    // not. Enabling it safely needs electron-builder's built-in fuses
    // config (or a verified newer electron-builder version) plus a real
    // signed-build test, neither of which this change can verify.
  })
}
