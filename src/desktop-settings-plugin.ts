/**
 * Prepare the bundled `dsh-my-desktop-setting` private plugin as a DSH `--patch`
 * overlay, mirroring how `prepareDesktopBridge` injects its private host+client
 * bundle.
 *
 * The plugin is a private, unpublished package (host+client): its built
 * artifacts (`lib/index.js` host entry, `lib/client.js` browser bundle,
 * `cordis.patch.yml`) ship inside the app and are materialized into a writable
 * per-user directory at launch. We then emit a top-level `--patch` overlay whose
 * insert row `name` is a `file:` URL to the host entry, exactly like the desktop
 * bridge (`desktop-host.ts:prepareDesktopBridge`). DSH imports the row directly,
 * so the host half applies in the server; the client half becomes an active
 * loader row whose `lib/client.js` is served by the DSH client-modules registry
 * as `/plugins/dsh-my-desktop-setting/client.js`.
 *
 * The plugin deliberately does NOT go into the web profile's
 * `dsh.profile.bundles` (that list is reserved for official bundles + registry
 * community plugins, and `pruneMissingProfileBundles`/`reconcileProfileBundles`
 * would drop or refuse a private package). Injection via `--patch` mirrors the
 * desktop-bridge precedent and needs no seed/reconcile changes.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Package name of the bundled desktop settings plugin. */
export const DESKTOP_SETTINGS_PACKAGE = 'dsh-my-desktop-setting'

/** Files copied from the shipped plugin source into the per-user bundle dir. */
export const DESKTOP_SETTINGS_FILES = [
  'lib/index.js',
  'lib/client.js',
] as const

/** Resolve the shipped plugin source directory (packaged resource vs dev checkout). */
export function resolveDesktopSettingsDir(options: { isPackaged: boolean; appPath: string; resourcesPath: string; pluginDevDir?: string }): string {
  if (!options.isPackaged) {
    // Dev run: an explicit override wins; otherwise fall back to the sibling
    // dsh-my-desktop-setting repo checkout so the plugin works out of the box.
    if (options.pluginDevDir !== undefined && options.pluginDevDir !== '') return options.pluginDevDir
    const sibling = join(dirname(options.appPath), 'dsh-my-desktop-setting')
    if (existsSync(join(sibling, 'lib', 'index.js'))) return sibling
    // No dev checkout and no env override: dev without the plugin is a no-op.
    return options.pluginDevDir ?? join(options.appPath, 'desktop-settings-plugin')
  }
  return join(options.resourcesPath, 'dsh-my-desktop-setting')
}

/**
 * Materialize the plugin into a writable dir and return the `--patch` overlay path
 * (or `undefined` when the shipped source is absent — e.g. a dev run without the
 * plugin built, which must not fail the whole desktop launch).
 */
export function prepareDesktopSettings(destDir: string, sourceDir: string): string | undefined {
  if (!existsSync(join(sourceDir, 'lib', 'index.js'))) return undefined
  mkdirSync(destDir, { recursive: true })
  mkdirSync(join(destDir, 'lib'), { recursive: true })
  for (const file of DESKTOP_SETTINGS_FILES) {
    const from = join(sourceDir, file)
    if (!existsSync(from)) throw new Error(`桌面设置插件文件缺失：${from}`)
    copyFileSync(from, join(destDir, file))
  }
  // A package.json with the DSH bundle/client contract so DSH resolves the
  // host entry and serves `lib/client.js` for the web profile.
  writeFileSync(join(destDir, 'package.json'), `${JSON.stringify({
    name: DESKTOP_SETTINGS_PACKAGE,
    version: '0.1.0',
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
  // Client registration (settings.section) happens in the plugin's own client
  // apply; the host applies via the overlay row below. Keep the package's own
  // bundle patch empty so DSH does not try to load a second, bare-name row.
  writeFileSync(join(destDir, 'cordis.patch.yml'), '[]\n', 'utf8')
  const overlayPath = join(destDir, 'settings.patch.yml')
  // JSON is valid YAML; a file: URL handles Windows paths, spaces and CJK dirs.
  writeFileSync(overlayPath, `${JSON.stringify([{ insert: [{
    id: DESKTOP_SETTINGS_PACKAGE,
    name: pathToFileURL(join(destDir, 'lib', 'index.js')).href,
  }] }], undefined, 2)}\n`, 'utf8')
  return overlayPath
}
