/**
 * Version store for the bundled `dsh-my-desktop-setting` plugin.
 *
 * WHY THIS EXISTS
 * ---------------
 * The settings plugin is part of the launcher's own UI, but shipping it only as a
 * resource inside the 300 MB installer means every one-line settings change needs
 * a full release. This module makes it **independently upgradeable**: the app
 * carries a baseline copy, and a newer copy can be dropped into a writable
 * per-user store and selected at launch without rebuilding the installer.
 *
 * DESIGN: keep the `--patch` overlay, move the TARGET
 * -------
 * We deliberately do NOT put this plugin into `dsh.profile.bundles` (the profile
 * lifecycle is user- and market-mutable, and the settings page must exist in
 * EVERY profile, including freshly created ones). Instead we keep the existing
 * `--patch` overlay, whose insert row `name` is a `file:` URL — but the URL now
 * points at the *selected version directory* rather than a fixed materialized
 * copy. A `file:` URL can target any directory on disk, so no ESM resolver hook
 * is needed (dsh-desktop needs one only because it resolves bare package names
 * from two roots).
 *
 * SELECTION RULE (mirrors dsh-desktop's install/profile overlay)
 * --------------------------------------------------------------
 * Installed versions live in `<store>/<version>/`. The highest valid SemVer wins.
 * The app's own shipped copy is *installed into the store* as its own version, so
 * it participates in the same comparison — and because equal precedence keeps the
 * app copy, a same-version install never shadows the sealed one.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Package name of the bundled desktop settings plugin. */
export const DESKTOP_SETTINGS_PACKAGE = 'dsh-my-desktop-setting'

/** Files that make up one installed copy of the plugin. */
export const DESKTOP_SETTINGS_FILES = [
  'lib/index.js',
  'lib/client.js',
] as const

/** Filename of the manifest recording which version is active. */
const ACTIVE_MANIFEST = 'active.json'

/** Parse a SemVer-ish string into comparable numeric parts; `undefined` if invalid. */
function parseVersion(version: string): { major: number; minor: number; patch: number } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim())
  if (match === null) return undefined
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return undefined
  return { major, minor, patch }
}

/** Compare two versions. Returns >0 when left is newer. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return -1
  if (b === undefined) return 1
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/** True when the directory holds a complete, loadable copy of the plugin. */
export function isCompleteSettingsVersion(versionDir: string): boolean {
  return DESKTOP_SETTINGS_FILES.every(file => existsSync(join(versionDir, file)))
}

/**
 * List installed versions, newest first.
 *
 * Entries that are not valid SemVer or are missing files are skipped rather than
 * trusted: a half-written directory (interrupted install) must never be selected.
 */
export function listSettingsVersions(versionsDir: string): string[] {
  if (!existsSync(versionsDir)) return []
  const entries: string[] = []
  try {
    for (const entry of readdirSync(versionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (parseVersion(entry.name) === undefined) continue
      if (!isCompleteSettingsVersion(join(versionsDir, entry.name))) continue
      entries.push(entry.name)
    }
  } catch {
    return []
  }
  return entries.sort(compareVersions).reverse()
}

/**
 * Pick the version to run: highest installed SemVer.
 *
 * Returns `undefined` when nothing is installed — the caller then falls back to
 * materializing the app's own copy into the store.
 */
export function selectSettingsVersion(versionsDir: string): string | undefined {
  return listSettingsVersions(versionsDir)[0]
}

/** Read the shipped plugin's own version, falling back to the app version. */
export function resolveDesktopSettingsVersion(sourceDir: string, fallback: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof manifest.version === 'string' && manifest.version !== '') return manifest.version
  } catch {
    // No readable manifest: the caller's fallback (the app version) is correct.
  }
  return fallback
}

/**
 * Write the DSH bundle/client contract manifest into an installed version dir.
 *
 * The plugin's real `cordis.patch.yml` is intentionally NOT applied here: the
 * overlay row in `settings.patch.yml` already mounts the host entry by `file:`
 * URL, and loading the package's own bundle patch as well would create a second,
 * bare-name row that DSH cannot resolve (it is a private, unpublished package).
 */
function writeSettingsManifest(versionDir: string, version: string): void {
  writeFileSync(join(versionDir, 'package.json'), `${JSON.stringify({
    name: DESKTOP_SETTINGS_PACKAGE,
    version,
    type: 'module',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: {
        inject: [
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-ui-renderer',
          '@deepseek-ai/dsh-client-ui-settings',
        ],
        platform: 'web',
      },
    },
  }, undefined, 2)}\n`, 'utf8')
  writeFileSync(join(versionDir, 'cordis.patch.yml'), '[]\n', 'utf8')
}

/**
 * Install one version of the plugin into the store from a source directory.
 *
 * Copies only the built artifacts (never the source tree) and writes the manifest
 * the DSH loader needs. Installing the version that already exists is a no-op
 * refresh, which is how the app's own shipped copy gets seeded on first launch.
 *
 * Returns the installed version's directory.
 */
export function installSettingsVersion(
  versionsDir: string,
  sourceDir: string,
  version: string,
  options: { overwrite?: boolean } = {},
): string {
  const versionDir = join(versionsDir, version)
  if (existsSync(versionDir) && options.overwrite !== true) return versionDir
  mkdirSync(join(versionDir, 'lib'), { recursive: true })
  for (const file of DESKTOP_SETTINGS_FILES) {
    const from = join(sourceDir, file)
    if (!existsSync(from)) throw new Error(`桌面设置插件文件缺失：${from}`)
    copyFileSync(from, join(versionDir, file))
  }
  writeSettingsManifest(versionDir, version)
  return versionDir
}

/** Record which version is active (diagnostics + rollback visibility). */
export function writeActiveSettingsVersion(storeDir: string, version: string): void {
  writeFileSync(join(storeDir, ACTIVE_MANIFEST), `${JSON.stringify({
    packageName: DESKTOP_SETTINGS_PACKAGE,
    version,
    updatedAt: new Date().toISOString(),
  }, undefined, 2)}\n`, 'utf8')
}

/**
 * Remove a version from the store. The active version is never removed.
 *
 * Keeps the store from growing without bound as upgrades accumulate.
 */
export function removeSettingsVersion(versionsDir: string, version: string, activeVersion?: string): boolean {
  if (activeVersion !== undefined && version === activeVersion) return false
  const versionDir = join(versionsDir, version)
  if (!existsSync(versionDir)) return false
  rmSync(versionDir, { recursive: true, force: true })
  return true
}
