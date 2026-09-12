/**
 * Pack the desktop settings plugin and install it into the per-user version store.
 *
 * This is the "independently upgradeable" path: build the plugin, then drop it into
 * the running app's store as a new version. The launcher picks the highest SemVer on
 * next launch — no installer rebuild required.
 *
 *   node dist/scripts/install-desktop-settings.mjs [--appVersion 0.5.0]
 *
 * The app's own shipped copy is seeded by `prepareDesktopSettings` on every launch,
 * so installing a version <= the shipped one has no visible effect (equal precedence
 * keeps the app copy). Install a HIGHER version to override it.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const projectRoot = resolve(import.meta.dirname, '..', '..')
const pluginRepo = join(projectRoot, 'plugins', 'dsh-my-desktop-settings')

function parseArgs(argv) {
  const options = { appVersion: undefined, userData: undefined, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--appVersion') options.appVersion = argv[i + 1]
    else if (arg === '--userData') options.userData = argv[i + 1]
    else if (arg === '--dry-run') options.dryRun = true
  }
  return options
}

function die(message) {
  console.error(message)
  process.exit(1)
}

const options = parseArgs(process.argv.slice(2))

if (!existsSync(join(pluginRepo, 'package.json'))) die(`缺少插件源码：${pluginRepo}`)

// 1. Read the version the plugin itself declares.
const manifest = JSON.parse(await readFile(join(pluginRepo, 'package.json'), 'utf8'))
const version = manifest.version
if (typeof version !== 'string' || version === '') die('插件 package.json 缺少 version')

// 2. Build it so the artifact matches the committed source.
console.log(`构建插件 (${version})…`)
const pnpm = resolvePnpm()
execFileSync(process.execPath, [pnpm, '--dir', pluginRepo, 'run', 'build'], { stdio: 'inherit' })

const libIndex = join(pluginRepo, 'lib', 'index.js')
const libClient = join(pluginRepo, 'lib', 'client.js')
if (!existsSync(libIndex) || !existsSync(libClient)) die('构建产物缺失：lib/index.js 或 lib/client.js')

// 3. Locate the per-user version store.
const userData = options.userData ?? defaultUserData()
const storeDir = join(userData, 'desktop-settings-plugin')
console.log(`版本存储：${storeDir}`)

if (options.dryRun) {
  console.log(`--dry-run：将安装版本 ${version}，当前已装：[${listVersions(storeDir).join(', ')}]`)
  process.exit(0)
}

// 4. Install: copy the built artifacts into <store>/<version>/.
//    Overwrite so re-running after a settings change actually takes effect.
const versionDir = join(storeDir, version)
rmSync(versionDir, { recursive: true, force: true })
mkdirSync(join(versionDir, 'lib'), { recursive: true })
copyFileSync(libIndex, join(versionDir, 'lib', 'index.js'))
copyFileSync(libClient, join(versionDir, 'lib', 'client.js'))

const { installSettingsVersion, writeActiveSettingsVersion } = await import(
  pathToFileURL(join(projectRoot, 'dist', 'src', 'bridge', 'desktop-settings-store.js')).href
)
// Write the DSH contract manifest via the shared helper (single definition).
installSettingsVersion(storeDir, pluginRepo, version, { overwrite: true })

console.log(`已安装版本 ${version}`)
console.log(`已装版本：[${listVersions(storeDir).join(', ')}]`)
console.log('下次启动即生效（完全退出应用后重启）。')

function listVersions(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => (e.isDirectory() || e.isSymbolicLink()) && /^\d+\.\d+\.\d+/.test(e.name))
      .map(e => e.name)
      .sort()
  } catch {
    return []
  }
}

function defaultUserData() {
  // Matches where prepareDesktopSettings writes: app.getPath('userData').
  const appData = process.env.APPDATA
  if (!appData) die('未找到 %APPDATA%，请用 --userData 指定')
  return join(appData, 'DSH My Desktop')
}

function resolvePnpm() {
  const entry = process.env.npm_execpath
  if (entry && existsSync(entry)) return entry
  const fallback = join(projectRoot, 'runtime-node', 'pnpm-package', 'bin', 'pnpm.cjs')
  if (existsSync(fallback)) return fallback
  die('未找到 pnpm 入口')
}
