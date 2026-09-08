import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { verifyBundledPluginsInstalled } from '../scripts/smoke-packaged-plugins.mjs'

// 测试用合成清单：真实 BUNDLED_PLUGINS 在最小化构建下为空，这里注入固定包以验证
// 校验脚本对“登记/加载/版本”的判定逻辑本身。
const CATALOG = [
  { packageName: '@sample/plugin-a', version: '0.2.112' },
  { packageName: 'dsh-context', version: '0.46.0' },
] as const

async function writePlugin(dshHome: string, packageName: string, version: string): Promise<void> {
  const packageDir = join(dshHome, 'profiles', 'web', 'node_modules', ...packageName.split('/'))
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: packageName, version }), 'utf8')
}

async function writeProfile(dshHome: string, omittedDependency?: string, omittedBundle?: string): Promise<void> {
  await writeFile(join(dshHome, 'profiles', 'web', 'package.json'), JSON.stringify({
    dependencies: Object.fromEntries(CATALOG.filter(plugin => plugin.packageName !== omittedDependency).map(plugin => [plugin.packageName, plugin.version])),
    dsh: { profile: { bundles: CATALOG.map(plugin => plugin.packageName).filter(name => name !== omittedBundle) } },
  }), 'utf8')
}

test('Unix 打包冒烟核对随包插件及固定版本', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-smoke-plugins-'))
  try {
    for (const plugin of CATALOG) await writePlugin(dshHome, plugin.packageName, plugin.version)
    await writeProfile(dshHome)
    await verifyBundledPluginsInstalled(dshHome, CATALOG)

    const missing = CATALOG[0]!
    await rm(join(dshHome, 'profiles', 'web', 'node_modules', ...missing.packageName.split('/')), { recursive: true })
    await assert.rejects(verifyBundledPluginsInstalled(dshHome, CATALOG), new RegExp(`缺少插件：${missing.packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('打包冒烟拒绝文件齐全但未登记或未加载的内置插件', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-smoke-registration-'))
  try {
    for (const plugin of CATALOG) await writePlugin(dshHome, plugin.packageName, plugin.version)
    const plugin = CATALOG[0]!.packageName
    await writeProfile(dshHome, plugin)
    await assert.rejects(verifyBundledPluginsInstalled(dshHome, CATALOG), /未登记内置插件/)
    await writeProfile(dshHome, undefined, plugin)
    await assert.rejects(verifyBundledPluginsInstalled(dshHome, CATALOG), /未启用内置插件/)
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('Unix 打包冒烟拒绝错误插件版本', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-smoke-plugins-'))
  try {
    for (const plugin of CATALOG) await writePlugin(dshHome, plugin.packageName, plugin.version)
    const mismatched = CATALOG.at(-1)!
    await writePlugin(dshHome, mismatched.packageName, '0.0.0-test')
    await assert.rejects(verifyBundledPluginsInstalled(dshHome, CATALOG), new RegExp(`版本错误：${mismatched.packageName}=0.0.0-test`))
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})
