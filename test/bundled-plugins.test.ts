import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { BUNDLED_PLUGINS, STORE_PACKAGES, OFFICIAL_DSH_VERSION, OFFICIAL_LAUNCH_PEERS, OFFICIAL_BROWSER_USE_PACKAGES, OFFICIAL_RUNTIME, bundledPluginSeedSpec, compareReleaseVersions, isDeepSeekOfficialPackage, isOfficialDshPackage, officialDshVersionOverrides, officialRuntimeDependencies, officialRuntimePnpmConfig, planOfficialRuntimeTarget, pnpmAllowBuildsManifest, pnpmWorkspaceYaml, bundledPluginNames, seededPackageNames, vendorTarballDir, vendorTarballName, type BundledPlugin } from '../src/runtime/bundled-plugins.js'

/** 机制夹具：清单为空，但下面这些函数在重新启用预装时仍要按同样规则工作。 */
const SYNTH_VENDORED: BundledPlugin = {
  packageName: '@sample/plugin-bundled',
  version: '1.2.3',
  vendorTarball: 'vendor/sample/sample-plugin-bundled-1.2.3.tgz',
}
const SYNTH_REGISTRY: BundledPlugin = { packageName: 'sample-community', version: '2.0.0' }

test('随包社区插件清单为空：0.8.4 起不预装社区插件', () => {
  // 清空的原因记在 BUNDLED_PLUGINS 的注释里：社区插件的 peer 追不上官方家族的预发布号，
  // 随包预装会把上游兼容性变成每次升版的阻塞项。
  assert.deepEqual(bundledPluginNames(), [])
  assert.deepEqual(STORE_PACKAGES, [])
})

test('随包插件钉死精确版本', () => {
  for (const plugin of BUNDLED_PLUGINS) {
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/, `${plugin.packageName} 必须是精确版本`)
  }
  // 重新启用时这条同样约束合成夹具，保证规则本身没被空清单测成空转。
  assert.match(SYNTH_REGISTRY.version, /^\d+\.\d+\.\d+$/)
})

test('随包插件分两类：registry 社区包 + 随仓产物包，各自来源明确', () => {
  const vendoredNames = new Set(BUNDLED_PLUGINS.filter(plugin => plugin.vendorTarball !== undefined).map(plugin => plugin.packageName))
  // 走 registry 的项不能悄悄带 vendorTarball，反之亦然——两类来源必须显式。
  for (const plugin of BUNDLED_PLUGINS) {
    if (vendoredNames.has(plugin.packageName)) continue
    assert.equal(plugin.vendorTarball, undefined, `${plugin.packageName} 不应声明 vendorTarball`)
  }
  assert.equal(SYNTH_VENDORED.vendorTarball, 'vendor/sample/sample-plugin-bundled-1.2.3.tgz')
  assert.equal(SYNTH_REGISTRY.vendorTarball, undefined)
})

test('随仓产物 tarball 已入库且校验文件存在', () => {
  // 产物是二进制 blob：丢了/没提交会让出包阶段直接失败，所以在单测里先钉住。
  for (const plugin of BUNDLED_PLUGINS) {
    if (plugin.vendorTarball === undefined) continue
    const artifact = join(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), plugin.vendorTarball)
    assert.equal(existsSync(artifact), true, `缺少随包产物：${plugin.vendorTarball}`)
    assert.equal(existsSync(`${artifact}.sha256`), true, `缺少产物校验文件：${plugin.vendorTarball}.sha256`)
  }
})

test('产物在 store 内的落点由单一函数推导，装配侧与补种侧不会漂移', () => {
  const store = join(tmpdir(), 'some-store')
  assert.equal(vendorTarballDir(store), join(store, 'vendor-tarballs'))
  // pnpm 的命名规则：@scope/name → scope-name-version.tgz；无 scope 则原样。
  assert.equal(vendorTarballName(SYNTH_VENDORED), 'sample-plugin-bundled-1.2.3.tgz')
  assert.equal(vendorTarballName(SYNTH_REGISTRY), 'sample-community-2.0.0.tgz')
  // 每个随仓产物的文件名必须与它在仓库里的实际路径结尾一致：装配侧拷进 store 用的
  // 就是这个推导名，对不上会让补种找不到文件（该缺陷已犯过一次）。
  for (const plugin of BUNDLED_PLUGINS) {
    if (plugin.vendorTarball === undefined) continue
    assert.ok(
      plugin.vendorTarball.endsWith(vendorTarballName(plugin)),
      `${plugin.packageName}: vendorTarball 路径结尾应等于推导名 ${vendorTarballName(plugin)}，实际 ${plugin.vendorTarball}`,
    )
  }
  assert.ok(SYNTH_VENDORED.vendorTarball?.endsWith(vendorTarballName(SYNTH_VENDORED)))
})

test('产物缺失时报错而不是回退 registry（该版本 npm 上不存在）', async () => {
  const store = await mkdtemp(join(tmpdir(), 'dsh-vendor-spec-'))
  try {
    const plugin = SYNTH_VENDORED
    // 回退成 name@version 会让 pnpm 去找一个从不存在的版本；报错要点名期望路径。
    assert.throws(() => bundledPluginSeedSpec(plugin, store), /产物缺失/)
    // 没有 storeDir 时同样拒绝，而不是静默降级。
    assert.throws(() => bundledPluginSeedSpec(plugin, undefined), /需要 store 目录/)
  } finally {
    await rm(store, { recursive: true, force: true })
  }
})

test('产物就位时补种 spec 指向 file: 路径', async () => {
  const store = await mkdtemp(join(tmpdir(), 'dsh-vendor-spec-'))
  try {
    const plugin = SYNTH_VENDORED
    // Put a file exactly where the staging step will put the real artifact.
    await mkdir(vendorTarballDir(store), { recursive: true })
    await writeFile(join(vendorTarballDir(store), vendorTarballName(plugin)), 'stub', 'utf8')
    const spec = bundledPluginSeedSpec(plugin, store)
    assert.ok(spec.startsWith('file:'), spec)
    // Forward slashes: the spec is consumed by pnpm, and a Windows path with
    // backslashes would be mangled by shell/URL parsing.
    assert.ok(!spec.includes('\\'), spec)
    assert.ok(spec.endsWith(vendorTarballName(plugin)), spec)
  } finally {
    await rm(store, { recursive: true, force: true })
  }
})

test('社区插件补种 spec 仍是 registry 的 name@version', () => {
  const community: BundledPlugin = SYNTH_REGISTRY
  assert.equal(bundledPluginSeedSpec(community), `${community.packageName}@${community.version}`)
})

test('所有 DeepSeek 官方作用域包使用同一套隔离判定', () => {
  assert.equal(isOfficialDshPackage('@deepseek-ai/dsh'), true)
  assert.equal(isOfficialDshPackage('@deepseek-ai/cordis-plugin-group'), false)
  assert.equal(isDeepSeekOfficialPackage('@deepseek-ai/cordis-plugin-group'), true)
  assert.equal(isDeepSeekOfficialPackage('@sample/plugin-a'), false)
})

test('补种清单 = 官方运行时（社区插件清单为空时不再带上任何社区包）', () => {
  assert.deepEqual(seededPackageNames(), ['@deepseek-ai/dsh'])
})

test('官方 DSH 家族锁在同一个精确版本', () => {
  assert.equal(OFFICIAL_RUNTIME.packageName, '@deepseek-ai/dsh')
  assert.equal(OFFICIAL_RUNTIME.version, OFFICIAL_DSH_VERSION)
  assert.equal(OFFICIAL_DSH_VERSION, '0.1.7-alpha.1')
  assert.equal(seededPackageNames()[0], '@deepseek-ai/dsh')
  assert.equal(OFFICIAL_LAUNCH_PEERS[0]?.packageName, '@deepseek-ai/cordis-plugin-group')
  assert.equal(OFFICIAL_LAUNCH_PEERS[0]?.version, '1.0.2')
  assert.equal(officialRuntimeDependencies()['@deepseek-ai/dsh-invariants'], OFFICIAL_DSH_VERSION)
  assert.deepEqual(officialDshVersionOverrides(), {
    '@deepseek-ai/dsh': OFFICIAL_DSH_VERSION,
    '@deepseek-ai/dsh-*': OFFICIAL_DSH_VERSION,
  })
  assert.equal(officialRuntimePnpmConfig().overrides['@deepseek-ai/dsh-*'], OFFICIAL_DSH_VERSION)
})

test('随包浏览器能力包跟家族同锁版本，且绝不进 profile 补种清单', () => {
  assert.deepEqual(OFFICIAL_BROWSER_USE_PACKAGES.map(plugin => plugin.packageName), [
    '@deepseek-ai/dsh-browser-use',
    '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
  ])
  for (const plugin of OFFICIAL_BROWSER_USE_PACKAGES) {
    assert.equal(plugin.version, OFFICIAL_DSH_VERSION)
    assert.equal(officialRuntimeDependencies()[plugin.packageName], OFFICIAL_DSH_VERSION)
    // 这两个包是 @deepseek-ai/dsh-* 官方作用域，reconcileProfileBundles 对官方名直接跳过，
    // 于是它们进不了 profile 的 dsh.profile.bundles；一旦躺在 profile node_modules 里就会被
    // 启动插件对账当成未声明的多余包摘掉（实测过）。所以只能作为运行时依赖随包。
    assert.equal(BUNDLED_PLUGINS.includes(plugin), false)
    assert.equal(seededPackageNames().includes(plugin.packageName), false)
  }
})

test('官方版本比较和升级目标不会把已对齐的新版本降回去', () => {
  assert.equal(compareReleaseVersions('0.1.0-rc.8', '0.1.0-rc.7') > 0, true)
  assert.equal(compareReleaseVersions('1.0.0-beta.1', '1.0.0-alpha.9') > 0, true)
  assert.equal(compareReleaseVersions('1.0.0', '1.0.0-beta.9') > 0, true)
  assert.equal(planOfficialRuntimeTarget({
    installed: '0.1.0-rc.7',
    aligned: false,
    baked: '0.1.0-rc.8',
  }), '0.1.0-rc.8')
  assert.equal(planOfficialRuntimeTarget({
    installed: '0.1.0-rc.8',
    aligned: true,
    baked: '0.1.0-rc.8',
    published: '0.1.0-rc.9',
  }), '0.1.0-rc.9')
  assert.equal(planOfficialRuntimeTarget({
    installed: '0.1.0-rc.9',
    aligned: true,
    baked: '0.1.0-rc.8',
  }), undefined)
})

test('装配与补种会放行 DSH 所需的原生构建脚本', () => {
  const allow = pnpmAllowBuildsManifest()
  assert.equal(allow.allowBuilds['node-pty'], true)
  assert.equal(allow.allowBuilds['@deepseek-ai/dsh-subprocess-local'], true)
  assert.match(pnpmWorkspaceYaml(), /allowBuilds:/)
  assert.match(pnpmWorkspaceYaml(), /autoInstallPeers:\s*true/)
  assert.match(pnpmWorkspaceYaml(false), /autoInstallPeers:\s*false/)
})
