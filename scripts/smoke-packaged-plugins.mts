import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUNDLED_PLUGINS, type BundledPlugin } from '../src/runtime/bundled-plugins.js'
import { applyMarketPreference } from '../src/profiles/market-preference.js'

interface PackageManifest {
  version?: unknown
}

/**
 * 冒烟用的是应用自己新建的 profile，名字由启动器的默认值决定（当前是 `dsh-my-desktop`，
 * 见 `src/profiles/profiles.ts` 的 `DEFAULT_PROFILE_NAME`），所以这里按目录实际内容解析，
 * 而不是写死某个名字——写死过一次，默认 profile 改名后这条校验就一直报「缺少插件」。
 */
function resolveSmokeProfileDir(profilesRoot: string): string {
  let entries: string[]
  try {
    entries = readdirSync(profilesRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && readdirSync(join(profilesRoot, entry.name)).length > 0)
      .map(entry => entry.name)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`未找到冒烟 profile 目录：${profilesRoot}（${detail}）`)
  }
  if (entries.length !== 1) throw new Error(`无法判定冒烟 profile，候选：${entries.join(', ') || '（空）'}`)
  return join(profilesRoot, entries[0]!)
}

/** 验证隔离 Profile 完全依靠随包 store 安装了全部固定版本插件。 */
export async function verifyBundledPluginsInstalled(dshHome: string, catalog: readonly BundledPlugin[] = BUNDLED_PLUGINS): Promise<void> {
  const profileDir = resolveSmokeProfileDir(join(dshHome, 'profiles'))
  // 市场开关决定 dshmarket 在不在补种里：新 profile 默认开启（0.8.5），显式关掉的 profile 首启
  // 本来就不该装它。校验必须走同一套判定，否则会在该装的时候报缺、不该装的时候报多。
  const plugins = applyMarketPreference(catalog, profileDir)
  for (const plugin of plugins) {
    const manifestPath = join(profileDir, 'node_modules', ...plugin.packageName.split('/'), 'package.json')
    let manifest: PackageManifest
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`强制离线首启缺少插件：${plugin.packageName}（${detail}）`)
    }
    if (manifest.version !== plugin.version) {
      throw new Error(`强制离线首启插件版本错误：${plugin.packageName}=${String(manifest.version)}`)
    }
  }
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, unknown>
    dsh?: { profile?: { bundles?: unknown } }
  }
  const bundles = manifest.dsh?.profile?.bundles
  for (const plugin of plugins) {
    const declared = manifest.dependencies?.[plugin.packageName]
    if (typeof declared !== 'string' || declared.trim() === '') {
      throw new Error(`强制离线首启未登记内置插件：${plugin.packageName}`)
    }
    if (!Array.isArray(bundles) || !bundles.includes(plugin.packageName)) {
      throw new Error(`强制离线首启未启用内置插件：${plugin.packageName}`)
    }
  }
}

const self = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const dshHome = process.argv[2]
  if (dshHome === undefined || dshHome === '') throw new Error('缺少待校验的 DSH_HOME。')
  await verifyBundledPluginsInstalled(dshHome)
}
