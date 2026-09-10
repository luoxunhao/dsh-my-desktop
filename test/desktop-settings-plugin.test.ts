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
    const dest = join(root, 'out')
    const patch = prepareDesktopSettings(dest, source)
    assert.ok(patch !== undefined)
    // Host + client bundles and manifest are materialized.
    assert.equal(existsSync(join(dest, 'lib', 'index.js')), true)
    assert.equal(existsSync(join(dest, 'lib', 'client.js')), true)
    const manifest = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'))
    assert.equal(manifest.name, DESKTOP_SETTINGS_PACKAGE)
    assert.equal(manifest.main, 'lib/index.js')
    assert.equal(manifest.exports['./client'], './lib/client.js')
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.equal(manifest.dsh.client.platform, 'web')
    // Overlay inserts a row whose `name` is a file URL to the host entry.
    const overlay = JSON.parse(readFileSync(join(dest, 'settings.patch.yml'), 'utf8'))
    assert.equal(overlay.length, 1)
    const row = overlay[0].insert[0]
    assert.equal(row.id, DESKTOP_SETTINGS_PACKAGE)
    assert.ok(row.name.startsWith('file://'))
    assert.ok(row.name.endsWith('lib/index.js'), row.name)
    // cordis.patch.yml is emptied so DSH does not load a second bare row.
    assert.equal(readFileSync(join(dest, 'cordis.patch.yml'), 'utf8').trim(), '[]')
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
    const manifest = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'))
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
