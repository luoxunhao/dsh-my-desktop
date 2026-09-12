import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { BUNDLED_PLUGINS, STORE_PACKAGES, OFFICIAL_DSH_VERSION, OFFICIAL_LAUNCH_PEERS, OFFICIAL_RUNTIME, bundledPluginSeedSpec, compareReleaseVersions, isDeepSeekOfficialPackage, isOfficialDshPackage, officialDshVersionOverrides, officialRuntimeDependencies, officialRuntimePnpmConfig, planOfficialRuntimeTarget, pnpmAllowBuildsManifest, pnpmWorkspaceYaml, bundledPluginNames, seededPackageNames, vendorTarballDir, vendorTarballName } from '../src/runtime/bundled-plugins.js'

const CODEX = '@luoxunhao/dsh-codex-project'
const QUOTE = 'dsh-quote'

test('随包社区插件清单：离线预装 6 个插件（随 store.tgz 打进安装包）', () => {
  // 预装走「出包时装配离线 store」而非首启联网下载：清单非空 ⇒ prepare-runtime
  // 会装配并打包 store.tgz，首启零联网即可补种。
  assert.deepEqual(bundledPluginNames(), ['dshmarket', 'dsh-better-sidebar', 'dsh-vision-router', 'dsh-context', CODEX, QUOTE])
  assert.deepEqual(STORE_PACKAGES, BUNDLED_PLUGINS)
  assert.equal(bundledPluginNames().includes('dshmarket'), true)
})

test('随包插件钉死精确版本', () => {
  for (const plugin of BUNDLED_PLUGINS) {
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/, `${plugin.packageName} 必须是精确版本`)
  }
  assert.deepEqual(
    Object.fromEntries(BUNDLED_PLUGINS.map(plugin => [plugin.packageName, plugin.version])),
    {
      dshmarket: '1.45.1',
      'dsh-better-sidebar': '0.19.1',
      'dsh-vision-router': '2.1.6',
      'dsh-context': '0.50.0',
      [CODEX]: '0.12.0',
      [QUOTE]: '0.1.0',
    },
  )
})

test('随包插件分两类：registry 社区包 + 随仓产物包，各自来源明确', () => {
  const vendored = BUNDLED_PLUGINS.filter(plugin => plugin.vendorTarball !== undefined)
  // 这两个走随仓产物，都是「适配本运行时的版本没发 npm」：
  //  - codex-project：npm 上最新的 0.11.0 是 0.1.2-alpha 线，peer ^0.1.0-rc.6 拒 0.1.5-rc.x；
  //  - dsh-quote：npm 上只有 0.0.1，本地适配版 0.1.0 未发布。
  assert.deepEqual(vendored.map(plugin => plugin.packageName), [CODEX, QUOTE])
  // 其余社区包必须走 registry 精确版本，不能悄悄带 vendorTarball。
  const vendoredNames = new Set(vendored.map(plugin => plugin.packageName))
  for (const plugin of BUNDLED_PLUGINS) {
    if (vendoredNames.has(plugin.packageName)) continue
    assert.equal(plugin.vendorTarball, undefined, `${plugin.packageName} 不应声明 vendorTarball`)
  }
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
  const byName = Object.fromEntries(BUNDLED_PLUGINS.map(plugin => [plugin.packageName, vendorTarballName(plugin)]))
  assert.equal(byName[CODEX], 'luoxunhao-dsh-codex-project-0.12.0.tgz')
  assert.equal(byName[QUOTE], 'dsh-quote-0.1.0.tgz')
  // 每个随仓产物的文件名必须与它在仓库里的实际路径结尾一致：装配侧拷进 store 用的
  // 就是这个推导名，对不上会让补种找不到文件（该缺陷已犯过一次）。
  for (const plugin of BUNDLED_PLUGINS) {
    if (plugin.vendorTarball === undefined) continue
    assert.ok(
      plugin.vendorTarball.endsWith(vendorTarballName(plugin)),
      `${plugin.packageName}: vendorTarball 路径结尾应等于推导名 ${vendorTarballName(plugin)}，实际 ${plugin.vendorTarball}`,
    )
  }
})

test('产物缺失时报错而不是回退 registry（该版本 npm 上不存在）', async () => {
  const store = await mkdtemp(join(tmpdir(), 'dsh-vendor-spec-'))
  try {
    const plugin = BUNDLED_PLUGINS.find(item => item.vendorTarball !== undefined)!
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
    const plugin = BUNDLED_PLUGINS.find(item => item.vendorTarball !== undefined)!
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
  const community = BUNDLED_PLUGINS.find(plugin => plugin.vendorTarball === undefined)!
  assert.equal(bundledPluginSeedSpec(community), `${community.packageName}@${community.version}`)
})

test('所有 DeepSeek 官方作用域包使用同一套隔离判定', () => {
  assert.equal(isOfficialDshPackage('@deepseek-ai/dsh'), true)
  assert.equal(isOfficialDshPackage('@deepseek-ai/cordis-plugin-group'), false)
  assert.equal(isDeepSeekOfficialPackage('@deepseek-ai/cordis-plugin-group'), true)
  assert.equal(isDeepSeekOfficialPackage('@sample/plugin-a'), false)
})

test('补种清单 = 官方运行时 + 随包社区插件', () => {
  assert.deepEqual(seededPackageNames(), ['@deepseek-ai/dsh', 'dshmarket', 'dsh-better-sidebar', 'dsh-vision-router', 'dsh-context', CODEX, QUOTE])
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
