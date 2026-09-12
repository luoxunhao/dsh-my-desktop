import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DESKTOP_SETTINGS_PACKAGE,
  prepareDesktopSettings,
  resolveDesktopSettingsDir,
  resolveDesktopSettingsVersion,
} from '../src/bridge/desktop-settings-plugin.js'
import {
  compareVersions,
  installSettingsVersion,
  listSettingsVersions,
  selectSettingsVersion,
} from '../src/bridge/desktop-settings-store.js'

/** Build a fake shipped plugin source with a minimal host+client bundle. */
function makePluginSource(root: string): string {
  const src = join(root, 'dsh-my-desktop-setting')
  mkdirSync(join(src, 'lib'), { recursive: true })
  writeFileSync(join(src, 'lib', 'index.js'), 'export const name = "dsh-my-desktop-setting"; export const apply = () => {};\n', 'utf8')
  writeFileSync(join(src, 'lib', 'client.js'), 'window.__ModuleLoader__.load({id:"dsh-my-desktop-setting",factory:()=>({})});\n', 'utf8')
  writeFileSync(join(src, 'cordis.patch.yml'), '[]\n', 'utf8')
  return src
}

test('准备桌面设置插件：物化包体并产出 --patch overlay（file URL 指向 host 入口）', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-plugin-'))
  try {
    const source = makePluginSource(root)
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: DESKTOP_SETTINGS_PACKAGE, version: '1.2.3' }), 'utf8')
    const dest = join(root, 'out')
    const patch = prepareDesktopSettings(dest, source)
    assert.ok(patch !== undefined)
    // The plugin is materialized under its own version directory.
    const versionDir = join(dest, '1.2.3')
    assert.equal(existsSync(join(versionDir, 'lib', 'index.js')), true)
    assert.equal(existsSync(join(versionDir, 'lib', 'client.js')), true)
    const manifest = JSON.parse(readFileSync(join(versionDir, 'package.json'), 'utf8'))
    assert.equal(manifest.name, DESKTOP_SETTINGS_PACKAGE)
    assert.equal(manifest.version, '1.2.3')
    assert.equal(manifest.main, 'lib/index.js')
    assert.equal(manifest.exports['./client'], './lib/client.js')
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.equal(manifest.dsh.client.platform, 'web')
    // Overlay inserts a row whose `name` is a file URL to the SELECTED host entry.
    const overlay = JSON.parse(readFileSync(join(dest, 'settings.patch.yml'), 'utf8'))
    assert.equal(overlay.length, 1)
    const row = overlay[0].insert[0]
    assert.equal(row.id, DESKTOP_SETTINGS_PACKAGE)
    assert.ok(row.name.startsWith('file://'))
    assert.ok(row.name.includes('1.2.3'), row.name)
    assert.ok(row.name.endsWith('lib/index.js'), row.name)
    // cordis.patch.yml is emptied so DSH does not load a second bare row.
    assert.equal(readFileSync(join(versionDir, 'cordis.patch.yml'), 'utf8').trim(), '[]')
    // The active version is recorded for diagnostics.
    const active = JSON.parse(readFileSync(join(dest, 'active.json'), 'utf8'))
    assert.equal(active.version, '1.2.3')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('准备桌面设置插件：源缺 host 入口时返回 undefined（不失败）', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-plugin-'))
  try {
    mkdirSync(join(root, 'empty'), { recursive: true })
    assert.equal(prepareDesktopSettings(join(root, 'dest'), join(root, 'empty')), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('物化清单的版本取自插件自身 package.json（不写死，避免随发布漂移）', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-version-'))
  try {
    const source = makePluginSource(root)
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: DESKTOP_SETTINGS_PACKAGE, version: '9.9.9' }), 'utf8')
    const dest = join(root, 'out')
    prepareDesktopSettings(dest, source, '1.2.3')
    // The version comes from the plugin's own package.json, so the materialized
    // copy lands in <store>/9.9.9/ and records that version.
    const manifest = JSON.parse(readFileSync(join(dest, '9.9.9', 'package.json'), 'utf8'))
    assert.equal(manifest.version, '9.9.9')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('插件清单缺失或损坏时回退到应用版本', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-version-'))
  try {
    // 无 package.json。
    const source = makePluginSource(join(root, 'a'))
    assert.equal(resolveDesktopSettingsVersion(source, '1.2.3'), '1.2.3')
    // 损坏的 JSON。
    const broken = makePluginSource(join(root, 'b'))
    writeFileSync(join(broken, 'package.json'), '{ not json', 'utf8')
    assert.equal(resolveDesktopSettingsVersion(broken, '1.2.3'), '1.2.3')
    // 版本字段为空。
    const empty = makePluginSource(join(root, 'c'))
    writeFileSync(join(empty, 'package.json'), JSON.stringify({ version: '' }), 'utf8')
    assert.equal(resolveDesktopSettingsVersion(empty, '1.2.3'), '1.2.3')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('解析桌面设置插件源目录：打包读资源，dev 优先显式覆盖/仓库内插件', () => {
  // packaged → resources/<pkg>
  assert.equal(
    resolveDesktopSettingsDir({ isPackaged: true, appPath: '/dev', resourcesPath: '/res' }),
    join('/res', DESKTOP_SETTINGS_PACKAGE),
  )
  // dev + explicit override wins.
  assert.equal(
    resolveDesktopSettingsDir({ isPackaged: false, appPath: '/dev', resourcesPath: '/res', pluginDevDir: '/my/plugin' }),
    '/my/plugin',
  )
  // dev without override and no in-repo lib falls back to the dev path (no plugin).
  assert.equal(
    resolveDesktopSettingsDir({ isPackaged: false, appPath: '/dev', resourcesPath: '/res' }),
    join('/dev', 'desktop-settings-plugin'),
  )
})

test('解析桌面设置插件源目录：dev 命中仓库内 plugins/dsh-my-desktop-settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-dev-'))
  try {
    // The in-repo plugin checkout lives at <appPath>/plugins/dsh-my-desktop-settings.
    const inRepo = join(root, 'plugins', 'dsh-my-desktop-settings')
    mkdirSync(join(inRepo, 'lib'), { recursive: true })
    writeFileSync(join(inRepo, 'lib', 'index.js'), 'export const name = "dsh-my-desktop-setting";\n', 'utf8')
    assert.equal(
      resolveDesktopSettingsDir({ isPackaged: false, appPath: root, resourcesPath: '/res' }),
      inRepo,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** Install a synthetic version (with distinct content) into the store. */
function installFakeVersion(storeDir: string, version: string): void {
  const dir = join(storeDir, version)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'lib', 'index.js'), `// version ${version}\n`, 'utf8')
  writeFileSync(join(dir, 'lib', 'client.js'), `// client ${version}\n`, 'utf8')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: DESKTOP_SETTINGS_PACKAGE, version }), 'utf8')
}

test('版本比较按 SemVer，忽略前缀与预发布后缀', () => {
  assert.ok(compareVersions('0.6.0', '0.5.0') > 0)
  assert.ok(compareVersions('0.5.0', '0.6.0') < 0)
  assert.equal(compareVersions('0.5.0', '0.5.0'), 0)
  assert.ok(compareVersions('1.0.0', '0.9.9') > 0)
  // Invalid versions never win.
  assert.ok(compareVersions('0.5.0', 'not-a-version') > 0)
})

test('选版取最高已装版本，并跳过不完整/非法的目录', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-versions-'))
  try {
    const store = join(root, 'store')
    installFakeVersion(store, '0.5.0')
    installFakeVersion(store, '0.6.0')
    installFakeVersion(store, '0.5.9')
    // A half-written directory (interrupted install) must never be selected.
    mkdirSync(join(store, '0.7.0', 'lib'), { recursive: true })
    writeFileSync(join(store, '0.7.0', 'lib', 'index.js'), '// incomplete\n', 'utf8')
    // Not a version at all.
    mkdirSync(join(store, 'latest'), { recursive: true })

    assert.deepEqual(listSettingsVersions(store), ['0.6.0', '0.5.9', '0.5.0'])
    assert.equal(selectSettingsVersion(store), '0.6.0')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('新装版本高于随包版本时，overlay 指向新版本（可独立升级）', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-upgrade-'))
  try {
    const source = makePluginSource(root)
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: DESKTOP_SETTINGS_PACKAGE, version: '0.5.0' }), 'utf8')
    const store = join(root, 'store')
    // An independently installed newer copy, as `settings:install` would produce.
    installFakeVersion(store, '0.6.0')

    const patch = prepareDesktopSettings(store, source, '0.5.0')
    assert.ok(patch !== undefined)
    const overlay = JSON.parse(readFileSync(join(store, 'settings.patch.yml'), 'utf8'))
    const row = overlay[0].insert[0]
    // The overlay must target the NEWER installed copy, not the app baseline.
    assert.ok(row.name.includes('0.6.0'), row.name)
    assert.equal(existsSync(join(store, '0.6.0', 'lib', 'client.js')), true)
    // The app's own copy is still seeded alongside it (rollback remains possible).
    assert.equal(existsSync(join(store, '0.5.0', 'lib', 'client.js')), true)
    // The installed bytes are the newer ones.
    assert.match(readFileSync(join(store, '0.6.0', 'lib', 'index.js'), 'utf8'), /version 0\.6\.0/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('随包版本更高时不被旧的安装副本覆盖', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-notdowngrade-'))
  try {
    const source = makePluginSource(root)
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: DESKTOP_SETTINGS_PACKAGE, version: '0.9.0' }), 'utf8')
    const store = join(root, 'store')
    installFakeVersion(store, '0.6.0')

    prepareDesktopSettings(store, source, '0.9.0')
    const overlay = JSON.parse(readFileSync(join(store, 'settings.patch.yml'), 'utf8'))
    assert.ok(overlay[0].insert[0].name.includes('0.9.0'), overlay[0].insert[0].name)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('安装同一版本只刷新内容，不产生重复目录', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-idempotent-'))
  try {
    const source = makePluginSource(root)
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: DESKTOP_SETTINGS_PACKAGE, version: '1.0.0' }), 'utf8')
    const store = join(root, 'store')
    installSettingsVersion(store, source, '1.0.0')
    installSettingsVersion(store, source, '1.0.0')
    assert.deepEqual(listSettingsVersions(store), ['1.0.0'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('源缺失文件是安装错误，不是静默跳过', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settings-missing-'))
  try {
    const source = join(root, 'source')
    mkdirSync(join(source, 'lib'), { recursive: true })
    assert.throws(
      () => installSettingsVersion(join(root, 'store'), source, '1.0.0'),
      /桌面设置插件文件缺失/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
