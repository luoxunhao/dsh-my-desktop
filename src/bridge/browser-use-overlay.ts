/**
 * 随包 browser-use 的启动期挂载 overlay。
 *
 * 官方 provider（`@deepseek-ai/dsh-browser-use` + 其 Chromium 实现
 * `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp`）的设计是**仅在显式挂载后
 * 启用**，所以"随包"（见 `src/runtime/bundled-plugins.ts` 的
 * `OFFICIAL_BROWSER_USE_PACKAGES`）只把代码放进运行时，不产生任何可见能力。
 * 本模块负责第二步：每次启动在 userData 下物化一个 `--patch` overlay，把两个 provider
 * 挂进当前选中的 profile，与 desktop 桥、桌面设置插件走的是同一条 overlay 通道。
 *
 * 为什么必须由启动器挂、不能让用户装进 profile：这两个包是 `@deepseek-ai/dsh-*` 官方
 * 作用域，`reconcileProfileBundles` 对官方名直接跳过 ⟹ 进不了 `dsh.profile.bundles`，
 * 于是躺在 profile 里会被启动插件对账当成多余包摘掉（0.8.1 那轮实测过）。
 *
 * 浏览器二进制：provider 拼给 `@playwright/mcp` 的子进程 env 只保留 `PLAYWRIGHT_MCP_*`
 * 且全部置空（见其 lib/index.js），`PLAYWRIGHT_BROWSERS_PATH` 一类变量根本传不进去，
 * 所以**唯一**可用的定位通道是配置项 `executablePath`（→ `--executable-path`）。这里按
 * Chrome → Edge 探测系统浏览器；探不到时不写该字段，退回 playwright 自己的默认发现
 * （`%LOCALAPPDATA%\ms-playwright`），由 provider 在真正用到浏览器时报错。
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** overlay 里两个挂载点的稳定 id：用户可在自己的 cordis.patch.yml 里按 id 覆盖或禁用。 */
export const BROWSER_USE_PROVIDER_ID = 'browser-use'
export const BROWSER_USE_PLAYWRIGHT_MCP_ID = 'browser-use-playwright-mcp'

export const BROWSER_USE_PACKAGES = {
  provider: '@deepseek-ai/dsh-browser-use',
  chromium: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
} as const

/** 关掉默认挂载的逃生开关（开发树未装配这两个包、或不想引入浏览器工具时用）。 */
export const BROWSER_USE_DISABLE_ENV = 'DSH_DISABLE_BROWSER_USE'

export interface BrowserUseOverlayOptions {
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  fileExists?: (path: string) => boolean
  /** 默认 true：provider 在该模式下走 headless shell，体积与打扰都最小。 */
  headless?: boolean
}

const CHROME_FILE = join('Google', 'Chrome', 'Application', 'chrome.exe')
const EDGE_FILE = join('Microsoft', 'Edge', 'Application', 'msedge.exe')

/**
 * 系统 Chromium 系浏览器的候选路径，按优先级排列。
 *
 * 只用环境变量里的目录，不写死 `C:\Program Files`：安装盘因机器而异，且 ProgramFiles(x86)
 * 在 32 位进程下会指向别处，所以两者都列进候选。
 */
export function chromiumCandidatePaths(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== 'win32') return []
  const roots = [env['PROGRAMFILES'], env['ProgramFiles(x86)'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']]
    .filter((value): value is string => typeof value === 'string' && value !== '')
  const unique = [...new Set(roots)]
  return unique.flatMap((root) => [join(root, CHROME_FILE), join(root, EDGE_FILE)])
}

/** 探测到一个可执行的系统 Chromium 系浏览器；都没有则 undefined（退回 playwright 默认发现）。 */
export function resolveChromiumExecutable(options: BrowserUseOverlayOptions = {}): string | undefined {
  const fileExists = options.fileExists ?? existsSync
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  return chromiumCandidatePaths(env, platform).find((candidate) => fileExists(candidate))
}

/**
 * 随包运行时里是否真的装配了 provider。
 *
 * 开发树可能还没跑过 `prepare-runtime`，此时挂一个解析不到的 bundle 只会让每次启动多两条
 * 噪音，所以直接不挂。检查顶层与 DSH 自身嵌套两处：npm 全局安装把依赖放在哪一层不完全由
 * 我们决定。
 */
export function browserUseRuntimeIsAvailable(
  runtimeRoot: string,
  options: Pick<BrowserUseOverlayOptions, 'fileExists'> = {},
): boolean {
  const fileExists = options.fileExists ?? existsSync
  const nested = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules')
  return [join(runtimeRoot, 'node_modules'), nested]
    .some((root) => fileExists(join(root, ...BROWSER_USE_PACKAGES.chromium.split('/'), 'package.json')))
}

/**
 * 物化 overlay 并返回它的路径；返回 undefined 表示本次启动不挂载（被禁用 / 运行时没装配）。
 *
 * 写成 JSON：JSON 是合法 YAML，且这样不必引入 YAML 序列化依赖，和 desktop 桥、设置插件的
 * overlay 生成方式保持一致。
 */
export function prepareBrowserUseOverlay(
  destDir: string,
  runtimeRoot: string,
  options: BrowserUseOverlayOptions = {},
): string | undefined {
  const env = options.env ?? process.env
  if (env[BROWSER_USE_DISABLE_ENV] === '1') return undefined
  if (!browserUseRuntimeIsAvailable(runtimeRoot, options)) return undefined

  const executablePath = resolveChromiumExecutable(options)
  const chromiumConfig: Record<string, unknown> = {
    mode: 'launch',
    headless: options.headless ?? true,
    // 探到系统浏览器才写：留空时 provider 交给 playwright 自己发现（其默认路径是每用户缓存）。
    ...(executablePath === undefined ? {} : { executablePath }),
  }
  const overlayPath = join(destDir, 'browser-use.patch.yml')
  writeFileSync(overlayPath, `${JSON.stringify([{ insert: [
    { id: BROWSER_USE_PROVIDER_ID, name: BROWSER_USE_PACKAGES.provider },
    { id: BROWSER_USE_PLAYWRIGHT_MCP_ID, name: BROWSER_USE_PACKAGES.chromium, config: chromiumConfig },
  ] }], undefined, 2)}\n`, 'utf8')
  return overlayPath
}
