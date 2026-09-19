import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  BROWSER_USE_DISABLE_ENV,
  BROWSER_USE_PACKAGES,
  BROWSER_USE_PLAYWRIGHT_MCP_ID,
  BROWSER_USE_PROVIDER_ID,
  browserUseRuntimeIsAvailable,
  chromiumCandidatePaths,
  prepareBrowserUseOverlay,
  resolveChromiumExecutable,
} from '../src/bridge/browser-use-overlay.js'

const CHROME = join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
const EDGE = join('C:', 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')

const WIN_ENV = {
  PROGRAMFILES: join('C:', 'Program Files'),
  'ProgramFiles(x86)': join('C:', 'Program Files (x86)'),
  LOCALAPPDATA: join('C:', 'Users', 'me', 'AppData', 'Local'),
}

test('Windows 下按 Chrome 优先列出系统 Chromium 候选，并覆盖 32 位 Program Files', () => {
  const paths = chromiumCandidatePaths(WIN_ENV, 'win32')
  assert.equal(paths.includes(CHROME), true)
  assert.equal(paths.includes(EDGE), true)
  assert.ok(paths.indexOf(CHROME) < paths.indexOf(EDGE), 'Chrome 必须排在 Edge 前面')
  assert.equal(paths.some((path) => path.includes('Program Files (x86)')), true)
  // 同一目录只出现一次：PROGRAMFILES 与 PROGRAMFILES(X86) 大小写不同但值相同时不去重会重复探测。
  assert.equal(new Set(paths).size, paths.length)
})

test('非 Windows 平台不探测系统浏览器', () => {
  assert.deepEqual(chromiumCandidatePaths(WIN_ENV, 'darwin'), [])
  assert.equal(resolveChromiumExecutable({ env: WIN_ENV, platform: 'darwin', fileExists: () => true }), undefined)
})

test('探测取第一个真实存在的候选，缺 env 时返回 undefined', () => {
  const present = new Set([EDGE])
  assert.equal(resolveChromiumExecutable({ env: WIN_ENV, platform: 'win32', fileExists: (p) => present.has(p) }), EDGE)
  assert.equal(resolveChromiumExecutable({ env: {}, platform: 'win32', fileExists: () => true }), undefined)
})

test('运行时可用性检查同时认顶层与 DSH 嵌套两种安装布局', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  const manifest = join('package.json')
  const nested = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', ...BROWSER_USE_PACKAGES.chromium.split('/'))
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(nested, manifest), '{}', 'utf8')
  assert.equal(browserUseRuntimeIsAvailable(root), true)

  const top = join(root, 'node_modules', ...BROWSER_USE_PACKAGES.chromium.split('/'))
  rmrf(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
  mkdirSync(top, { recursive: true })
  writeFileSync(join(top, manifest), '{}', 'utf8')
  assert.equal(browserUseRuntimeIsAvailable(root), true)

  rmrf(top)
  assert.equal(browserUseRuntimeIsAvailable(root), false)
})

test('overlay 物化两行挂载点，探到浏览器时才写 executablePath', () => {
  const dest = mkdtempSync(join(tmpdir(), 'browser-use-overlay-'))
  const runtime = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  const installed = join(runtime, 'node_modules', ...BROWSER_USE_PACKAGES.chromium.split('/'), 'package.json')
  mkdirSync(dirname(installed), { recursive: true })
  writeFileSync(installed, '{}', 'utf8')

  const withBrowser = prepareBrowserUseOverlay(dest, runtime, {
    env: WIN_ENV, platform: 'win32', fileExists: fakeFs([CHROME, installed]),
  })
  assert.equal(withBrowser, join(dest, 'browser-use.patch.yml'))
  const rows = JSON.parse(readFileSync(withBrowser as string, 'utf8')) as Array<{ insert: Array<{ id: string, name: string, config?: Record<string, unknown> }> }>
  assert.equal(rows.length, 1)
  const [provider, chromium] = rows[0]!.insert
  assert.equal(provider!.id, BROWSER_USE_PROVIDER_ID)
  assert.equal(provider!.name, BROWSER_USE_PACKAGES.provider)
  assert.equal(chromium!.id, BROWSER_USE_PLAYWRIGHT_MCP_ID)
  assert.equal(chromium!.name, BROWSER_USE_PACKAGES.chromium)
  assert.deepEqual(chromium!.config, { mode: 'launch', headless: true, executablePath: CHROME })

  // 探不到系统浏览器：不写 executablePath，交回 playwright 自己的默认发现。
  prepareBrowserUseOverlay(dest, runtime, { env: WIN_ENV, platform: 'win32', fileExists: fakeFs([installed]) })
  const fallback = JSON.parse(readFileSync(withBrowser as string, 'utf8')) as Array<{ insert: Array<{ config?: Record<string, unknown> }> }>
  assert.deepEqual(fallback[0]!.insert[1]!.config, { mode: 'launch', headless: true })
})

test('逃生开关与运行时缺包时都不挂载', () => {
  const dest = mkdtempSync(join(tmpdir(), 'browser-use-overlay-'))
  const runtime = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  const installed = join(runtime, 'node_modules', ...BROWSER_USE_PACKAGES.chromium.split('/'), 'package.json')
  mkdirSync(dirname(installed), { recursive: true })
  writeFileSync(installed, '{}', 'utf8')
  // 文件里只有系统浏览器、没有 provider：可用性与探测两件事各自独立成立。
  const runtimeReady = fakeFs([CHROME, installed])

  assert.equal(prepareBrowserUseOverlay(dest, runtime, {
    env: { [BROWSER_USE_DISABLE_ENV]: '1' }, platform: 'win32', fileExists: runtimeReady,
  }), undefined, '开关打开时必须不挂载')
  assert.equal(existsSync(join(dest, 'browser-use.patch.yml')), false, '禁用时不该留下 overlay')

  const emptyRuntime = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  assert.equal(prepareBrowserUseOverlay(dest, emptyRuntime, {
    env: WIN_ENV, platform: 'win32', fileExists: fakeFs([CHROME]),
  }), undefined, '运行时没装配 provider 时不挂载')
})

/** 假文件系统：只认列出的路径，让每个用例只对一个变量取值。 */
function fakeFs(paths: readonly string[]): (path: string) => boolean {
  const present = new Set(paths)
  return (path: string) => present.has(path)
}

/** 同步删目录：测试里要在两种安装布局之间切换，用不着异步。 */
function rmrf(path: string): void {
  rmSync(path, { recursive: true, force: true })
}
