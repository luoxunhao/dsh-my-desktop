/**
 * Prepare the bundled `dsh-my-desktop-setting` private plugin as a DSH `--patch`
 * overlay.
 *
 * The plugin is a private, unpublished package (host+client). Its built artifacts
 * (`lib/index.js` host entry, `lib/client.js` browser bundle) ship inside the app
 * AND live in a per-user **version store** (`desktop-settings-store.ts`), so the
 * settings page can be upgraded without rebuilding the installer.
 *
 * The overlay's insert row `name` is a `file:` URL pointing at the SELECTED
 * version's host entry, exactly like the desktop bridge
 * (`desktop-host.ts:prepareDesktopBridge`). DSH imports the row directly, so the
 * host half applies in the server; the client half becomes an active loader row
 * whose `lib/client.js` is served by the DSH client-modules registry as
 * `/plugins/dsh-my-desktop-setting/client.js`.
 *
 * Why the plugin stays OUT of the web profile's `dsh.profile.bundles`:
 * that list is user- and market-mutable (profiles are created, switched, pruned),
 * and the desktop settings page is part of the launcher's own UI — it must exist
 * in every profile, including ones created a second from now. A `--patch` overlay
 * is launcher-owned and profile-independent, so it cannot be lost that way.
 * (The older comment claiming `pruneMissingProfileBundles`/`reconcileProfileBundles`
 * would drop a private package was measured and is no longer true; the real reason
 * is the lifecycle ownership above.)
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  compareVersions,
  DESKTOP_SETTINGS_PACKAGE,
  installSettingsVersion,
  resolveDesktopSettingsVersion,
  selectSettingsVersion,
  writeActiveSettingsVersion,
} from './desktop-settings-store.js'

/** Package name of the bundled desktop settings plugin. */
export { DESKTOP_SETTINGS_PACKAGE } from './desktop-settings-store.js'

/**
 * Read the shipped plugin's own version (falls back to the app version).
 * Re-exported so existing callers/tests keep one import site.
 */
export { resolveDesktopSettingsVersion } from './desktop-settings-store.js'

/** Files copied from the shipped plugin source into the per-user bundle dir. */
export { DESKTOP_SETTINGS_FILES } from './desktop-settings-store.js'

/** Resolve the shipped plugin source directory (packaged resource vs dev checkout). */
export function resolveDesktopSettingsDir(options: { isPackaged: boolean; appPath: string; resourcesPath: string; pluginDevDir?: string }): string {
  if (!options.isPackaged) {
    // Dev run: an explicit override wins; otherwise use the in-repo plugin
    // checkout so the plugin works out of the box.
    if (options.pluginDevDir !== undefined && options.pluginDevDir !== '') return options.pluginDevDir
    const inRepo = join(options.appPath, 'plugins', 'dsh-my-desktop-settings')
    if (existsSync(join(inRepo, 'lib', 'index.js'))) return inRepo
    // No built plugin: dev without the plugin is a no-op.
    return options.pluginDevDir ?? join(options.appPath, 'desktop-settings-plugin')
  }
  return join(options.resourcesPath, 'dsh-my-desktop-setting')
}

/**
 * Materialize the plugin into the version store and return the `--patch` overlay
 * path (or `undefined` when neither the store nor the shipped source has a
 * loadable copy — e.g. a dev run without the plugin built, which must not fail
 * the whole desktop launch).
 *
 * Flow:
 *  1. seed the app's own shipped copy into the store under its own version
 *     (cheap no-op refresh when already present), so it always participates;
 *  2. select the highest installed SemVer — that is the independently installed
 *     newer copy when one exists, otherwise the app's baseline;
 *  3. point the overlay row's `file:` URL at the selected version.
 *
 * `destDir` is the version store root (`<version>/` subdirs live inside it).
 * `appVersion` is the fallback when the shipped manifest is unreadable.
 */
export function prepareDesktopSettings(destDir: string, sourceDir: string, appVersion = '0.0.0'): string | undefined {
  const hasSource = existsSync(join(sourceDir, 'lib', 'index.js'))
  const shippedVersion = hasSource ? resolveDesktopSettingsVersion(sourceDir, appVersion) : undefined

  // Seed the shipped copy so the app's own version is always a candidate.
  if (hasSource && shippedVersion !== undefined) {
    installSettingsVersion(destDir, sourceDir, shippedVersion)
  }

  // An independently installed newer copy wins; otherwise the baseline does.
  const selected = selectSettingsVersion(destDir)
  if (selected === undefined) return undefined

  writeActiveVersion(destDir, selected)
  const selectedDir = join(destDir, selected)
  const overlayPath = join(destDir, 'settings.patch.yml')
  // JSON is valid YAML; a file: URL handles Windows paths, spaces and CJK dirs.
  writeFileSync(overlayPath, `${JSON.stringify([{ insert: [{
    id: DESKTOP_SETTINGS_PACKAGE,
    name: pathToFileURL(join(selectedDir, 'lib', 'index.js')).href,
  }] }], undefined, 2)}\n`, 'utf8')
  return overlayPath
}

/** Record the active version; a diagnostics file must never break the launch. */
function writeActiveVersion(storeDir: string, version: string): void {
  try {
    writeActiveSettingsVersion(storeDir, version)
  } catch {
    // Diagnostic write failure must not fail the launch.
  }
}

export { compareVersions }
