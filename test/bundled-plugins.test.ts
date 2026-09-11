import assert from 'node:assert/strict'
import test from 'node:test'

import { BUNDLED_PLUGINS, STORE_PACKAGES, OFFICIAL_DSH_VERSION, OFFICIAL_LAUNCH_PEERS, OFFICIAL_RUNTIME, compareReleaseVersions, isDeepSeekOfficialPackage, isOfficialDshPackage, officialDshVersionOverrides, officialRuntimeDependencies, officialRuntimePnpmConfig, planOfficialRuntimeTarget, pnpmAllowBuildsManifest, pnpmWorkspaceYaml, bundledPluginNames, seededPackageNames } from '../src/runtime/bundled-plugins.js'

test('随包社区插件清单：离线预装 dshmarket（随 store.tgz 打进安装包）', () => {
  // 预装走「出包时装配离线 store」而非首启联网下载：清单非空 ⇒ prepare-runtime
  // 会装配并打包 store.tgz，首启零联网即可补种。
  assert.deepEqual(bundledPluginNames(), ['dshmarket'])
  assert.deepEqual(STORE_PACKAGES, BUNDLED_PLUGINS)
  assert.equal(bundledPluginNames().includes('dshmarket'), true)
})

test('随包插件钉死精确版本', () => {
  for (const plugin of BUNDLED_PLUGINS) {
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/, `${plugin.packageName} 必须是精确版本`)
  }
  assert.deepEqual(
    Object.fromEntries(BUNDLED_PLUGINS.map(plugin => [plugin.packageName, plugin.version])),
    { dshmarket: '1.45.1' },
  )
})

test('所有 DeepSeek 官方作用域包使用同一套隔离判定', () => {
  assert.equal(isOfficialDshPackage('@deepseek-ai/dsh'), true)
  assert.equal(isOfficialDshPackage('@deepseek-ai/cordis-plugin-group'), false)
  assert.equal(isDeepSeekOfficialPackage('@deepseek-ai/cordis-plugin-group'), true)
  assert.equal(isDeepSeekOfficialPackage('@sample/plugin-a'), false)
})

test('补种清单 = 官方运行时 + 随包社区插件', () => {
  assert.deepEqual(seededPackageNames(), ['@deepseek-ai/dsh', 'dshmarket'])
})

test('官方 DSH 家族锁在同一个精确版本', () => {
  assert.equal(OFFICIAL_RUNTIME.packageName, '@deepseek-ai/dsh')
  assert.equal(OFFICIAL_RUNTIME.version, OFFICIAL_DSH_VERSION)
  assert.equal(OFFICIAL_DSH_VERSION, '0.1.5-rc.1')
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
