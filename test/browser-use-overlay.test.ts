import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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
  resolveRuntimePackageEntry,
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
  // 同一目录只出现一次：两个 env 变量值相同时不去重会重复探测。
  assert.equal(new Set(paths).size, paths.length)
})

test('非 Windows 平台不探测系统浏览器', () => {
  assert.deepEqual(chromiumCandidatePaths(WIN_ENV, 'darwin'), [])
  assert.equal(resolveChromiumExecutable({ env: WIN_ENV, platform: 'darwin', fileExists: () => true }), undefined)
})

test('探测取第一个真实存在的候选，缺 env 时返回 undefined', () => {
  assert.equal(resolveChromiumExecutable({ env: WIN_ENV, platform: 'win32', fileExists: fakeFs([EDGE]) }), EDGE)
  assert.equal(resolveChromiumExecutable({ env: {}, platform: 'win32', fileExists: () => true }), undefined)
})

test('运行时入口解析同时认顶层与 DSH 嵌套两种安装布局', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  // provider 放顶层、Chromium 实现放 DSH 嵌套：npm 会把版本冲突的包嵌进去，两处都得能找到。
  const top = installPackage(root, 'node_modules', BROWSER_USE_PACKAGES.provider)
  const nested = installPackage(root, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', BROWSER_USE_PACKAGES.chromium)
  const known = fakeFs([top.manifest, top.entry, nested.manifest, nested.entry])

  assert.equal(resolveRuntimePackageEntry(root, BROWSER_USE_PACKAGES.provider, { fileExists: known }), top.entry)
  assert.equal(resolveRuntimePackageEntry(root, BROWSER_USE_PACKAGES.chromium, { fileExists: known }), nested.entry)
  assert.equal(browserUseRuntimeIsAvailable(root, { fileExists: known }), true)

  rmSync(join(root, 'node_modules', ...BROWSER_USE_PACKAGES.provider.split('/')), { recursive: true, force: true })
  assert.equal(browserUseRuntimeIsAvailable(root, { fileExists: fakeFs([nested.manifest, nested.entry]) }), false,
    '两个包里缺任何一个都不能挂载：裸挂会让 DSH 子进程直接退出')
})

test('overlay 用入口的 file: URL 挂载两行，探到浏览器时才写 executablePath', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  const provider = installPackage(runtime, 'node_modules', BROWSER_USE_PACKAGES.provider)
  const chromium = installPackage(runtime, 'node_modules', BROWSER_USE_PACKAGES.chromium)
  const ready = [provider.manifest, provider.entry, chromium.manifest, chromium.entry]
  const dest = mkdtempSync(join(tmpdir(), 'browser-use-overlay-'))

  const withBrowser = prepareBrowserUseOverlay(dest, runtime, {
    env: WIN_ENV, platform: 'win32', fileExists: fakeFs([...ready, CHROME]),
  })
  assert.equal(withBrowser, join(dest, 'browser-use.patch.yml'))
  const rows = JSON.parse(readFileSync(withBrowser as string, 'utf8')) as Array<{ insert: Array<{ id: string, name: string, config?: Record<string, unknown> }> }>
  assert.equal(rows.length, 1)
  const [providerRow, chromiumRow] = rows[0]!.insert
  assert.equal(providerRow!.id, BROWSER_USE_PROVIDER_ID)
  assert.equal(chromiumRow!.id, BROWSER_USE_PLAYWRIGHT_MCP_ID)
  // 0.8.2 首发就是栽在写裸包名上：patch 的 include 以 profile 目录为解析基准，解析不到
  // 运行时里的包，DSH 子进程会 ERR_MODULE_NOT_FOUND 退出。这两条断言就是防它退回的。
  assert.equal(providerRow!.name, pathToFileURL(provider.entry).href)
  assert.equal(chromiumRow!.name, pathToFileURL(chromium.entry).href)
  assert.equal(providerRow!.name.startsWith('@'), false, '绝不能是裸包名')
  assert.deepEqual(chromiumRow!.config, { mode: 'launch', headless: true, executablePath: CHROME })

  // 探不到系统浏览器：不写 executablePath，交回 playwright 自己的默认发现。
  prepareBrowserUseOverlay(dest, runtime, { env: WIN_ENV, platform: 'win32', fileExists: fakeFs(ready) })
  const fallback = JSON.parse(readFileSync(withBrowser as string, 'utf8')) as Array<{ insert: Array<{ config?: Record<string, unknown> }> }>
  assert.deepEqual(fallback[0]!.insert[1]!.config, { mode: 'launch', headless: true })
})

test('逃生开关与运行时缺包时都不挂载', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  const provider = installPackage(runtime, 'node_modules', BROWSER_USE_PACKAGES.provider)
  const chromium = installPackage(runtime, 'node_modules', BROWSER_USE_PACKAGES.chromium)
  const ready = [provider.manifest, provider.entry, chromium.manifest, chromium.entry]
  const dest = mkdtempSync(join(tmpdir(), 'browser-use-overlay-'))

  assert.equal(prepareBrowserUseOverlay(dest, runtime, {
    env: { [BROWSER_USE_DISABLE_ENV]: '1' }, platform: 'win32', fileExists: fakeFs([...ready, CHROME]),
  }), undefined, '开关打开时必须不挂载')
  assert.equal(existsSync(join(dest, 'browser-use.patch.yml')), false, '禁用时不该留下 overlay')

  const emptyRuntime = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  assert.equal(prepareBrowserUseOverlay(dest, emptyRuntime, {
    env: WIN_ENV, platform: 'win32', fileExists: fakeFs([CHROME]),
  }), undefined, '运行时没装配 provider 时不挂载')
})

test('destDir 不存在时也要建出来并写出 overlay（0.8.2 首启崩溃的回归）', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  const provider = installPackage(runtime, 'node_modules', BROWSER_USE_PACKAGES.provider)
  const chromium = installPackage(runtime, 'node_modules', BROWSER_USE_PACKAGES.chromium)
  const ready = [provider.manifest, provider.entry, chromium.manifest, chromium.entry]
  // 全新安装的真实形态：userData/browser-use 这一层还不存在——0.8.2 就是这里抛 ENOENT，
  // 把整个启动路径带崩，DSH 子进程根本没起来。
  const dest = join(mkdtempSync(join(tmpdir(), 'browser-use-first-run-')), 'browser-use')
  assert.equal(existsSync(dest), false)

  const overlay = prepareBrowserUseOverlay(dest, runtime, {
    env: WIN_ENV, platform: 'win32', fileExists: fakeFs([...ready, EDGE]),
  })
  assert.equal(overlay, join(dest, 'browser-use.patch.yml'))
  assert.equal(existsSync(dest), true, '目录必须被建出来')
  assert.equal(existsSync(overlay as string), true)
})

test('overlay 写不下去时不挂载，也绝不把异常抛给启动路径', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-use-unwritable-'))
  const runtime = mkdtempSync(join(tmpdir(), 'browser-use-runtime-'))
  const provider = installPackage(runtime, 'node_modules', BROWSER_USE_PACKAGES.provider)
  const chromium = installPackage(runtime, 'node_modules', BROWSER_USE_PACKAGES.chromium)
  const ready = [provider.manifest, provider.entry, chromium.manifest, chromium.entry]
  // 拿一个"文件下面"当 destDir：mkdir 必然 ENOTDIR，模拟 userData 不可写/被占用的最坏情况。
  const blocker = join(root, 'not-a-dir')
  writeFileSync(blocker, '', 'utf8')

  assert.equal(prepareBrowserUseOverlay(join(blocker, 'browser-use'), runtime, {
    env: WIN_ENV, platform: 'win32', fileExists: fakeFs([...ready, CHROME]),
  }), undefined, '写失败要退化成不挂载，而不是抛出')
})

/** 在临时运行时目录里按给定相对路径装出一个包来，返回清单与入口位置。 */
function installPackage(root: string, ...layout: readonly string[]): { manifest: string, entry: string } {
  const dir = join(root, ...layout)
  const manifest = join(dir, 'package.json')
  const entry = join(dir, 'lib', 'index.js')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(manifest, JSON.stringify({ name: layout[layout.length - 1], main: 'lib/index.js' }), 'utf8')
  writeFileSync(entry, 'export const name = "x"\n', 'utf8')
  return { manifest, entry }
}

/** 假文件系统：只认列出的路径，让每个用例只对一个变量取值。 */
function fakeFs(paths: readonly string[]): (path: string) => boolean {
  const present = new Set(paths)
  return (path: string) => present.has(path)
}
