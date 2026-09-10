import { spawn, type ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'

import { APPLY_PLUGIN_UPDATES_IPC, OFFICIAL_DSH_VERSION, isDeepSeekOfficialPackage, isOfficialDshPackage } from './bundled-plugins.js'
import { desktopBridgeClientBundle } from './desktop-bridge-client-source.js'
import { finalizeProfileBundlesAfterInstall, officialRuntimeInstallArgs, writeOfficialRuntimeManifest } from './plugin-seed.js'
import { terminateProcessTree } from './process-control.js'
import {
  assertProfileName,
  deleteProfileDirectory,
  isSafeProfileName,
  listProfiles,
  profileDirFor,
  readActiveProfile,
  resolveProfileRoots,
  type ManagedProfile,
} from './profiles.js'

export const DESKTOP_BRIDGE_PACKAGE = 'dsh-desktop-bridge'

export interface DesktopPnpmHandle {
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>
  cancel(): void
}

export interface DesktopHostOptions {
  profileName: string
  profileDir: string
  desktopRuntimeDir?: string
  send?: (message: unknown) => void
  runner?: (args: readonly string[], cwd: string, signal?: AbortSignal) => DesktopPnpmHandle
  recycleDelayMs?: number
  isInstalled?: (packageName: string) => boolean
  /** Registry roots used to list/create/select/delete profiles. */
  profileRoots?: { home: string; stateDir: string }
  /**
   * Request/response channel to the Electron main for profile operations.
   * Resolves once main has finished the operation (so a delete is reflected by
   * the next `list()`). When absent, operations fall back to fire-and-forget.
   */
  request?: (message: DesktopProfileActionMessage, timeoutMs?: number) => Promise<void>
}

/**
 * Child→main request telling the Electron main to perform a profile operation
 * that must own the filesystem seed and/or relaunch (create seeds the new dir,
 * select persists active + relaunches, delete removes a dir). Main replies with
 * {@link DesktopProfileResultMessage} carrying the same `requestId`, so the
 * child can await completion (a delete must be finished before the next read).
 */
export type DesktopProfileActionMessage =
  | { type: 'desktop/profile/create'; requestId: string; name: string }
  | { type: 'desktop/profile/select'; requestId: string; name: string }
  | { type: 'desktop/profile/delete'; requestId: string; name: string }

/** Main→child reply for one profile operation. */
export interface DesktopProfileResultMessage {
  readonly type: 'desktop/profile/result'
  readonly requestId: string
  readonly ok: boolean
  readonly error?: string
}

export function isDesktopProfileActionMessage(value: unknown): value is DesktopProfileActionMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  if (message.type === 'desktop/profile/create' || message.type === 'desktop/profile/select' || message.type === 'desktop/profile/delete') {
    return typeof message.name === 'string' && isSafeProfileName(message.name)
      && typeof message.requestId === 'string' && message.requestId.length > 0
  }
  return false
}

export function isDesktopProfileResultMessage(value: unknown): value is DesktopProfileResultMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return message.type === 'desktop/profile/result'
    && typeof message.requestId === 'string' && message.requestId.length > 0
    && typeof message.ok === 'boolean'
}

/** Renderer-safe profile projection consumed by the settings section. */
export interface DesktopProfileBridgeView extends ManagedProfile {
  readonly current: boolean
}

/** Map a managed profile to the renderer-safe bridge projection. */
export function toDesktopProfileBridgeView(profile: ManagedProfile, active: string): DesktopProfileBridgeView {
  return Object.freeze({ ...profile, current: profile.name === active })
}

/**
 * Child→main request for a launcher-native side effect that must run in the
 * Electron main process (the renderer/web-profile process cannot apply it).
 * Fire-and-forget: main performs the action; no synchronous reply is needed
 * (several actions restart or open native UI).
 */
export type DesktopActionMessage =
  | { type: 'desktop/action/restart' }
  | { type: 'desktop/action/terminal/open' }
  | { type: 'desktop/action/devtools/toggle' }

export function isDesktopActionMessage(value: unknown): value is DesktopActionMessage {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as Record<string, unknown>).type
  return type === 'desktop/action/restart'
    || type === 'desktop/action/terminal/open'
    || type === 'desktop/action/devtools/toggle'
}

/** All child→main desktop messages the bridge may emit. */
export type DesktopHostMessage = DesktopProfileActionMessage | DesktopActionMessage

export function isDesktopHostMessage(value: unknown): value is DesktopHostMessage {
  return isDesktopProfileActionMessage(value) || isDesktopActionMessage(value)
}

export function shouldRecycleAfterPluginArgs(args: readonly string[]): boolean {
  return pluginCommandAction(args) !== 'other'
}

export function packageNameFromSpec(spec: string): string {
  if (spec.startsWith('@')) {
    const rest = spec.slice(1)
    const cut = rest.indexOf('@')
    return cut === -1 ? spec : '@' + rest.slice(0, cut)
  }
  return spec.split('@')[0] ?? spec
}

export function pluginCommandAction(args: readonly string[]): 'add' | 'remove' | 'update' | 'install' | 'other' {
  if (args.includes('add')) return 'add'
  if (args.includes('remove') || args.includes('uninstall')) return 'remove'
  if (args.includes('update')) return 'update'
  if (args.includes('install')) return 'install'
  return 'other'
}

export function pluginCommandPackageNames(args: readonly string[]): string[] {
  return args
    .filter((item) => item !== 'add' && item !== 'remove' && item !== 'uninstall' && item !== 'update' && item !== 'install' && !item.startsWith('-'))
    .map(packageNameFromSpec)
}

export function officialPluginCommandSpecs(args: readonly string[]): string[] {
  return args
    .filter((item) => item !== 'add' && item !== 'remove' && item !== 'uninstall' && item !== 'update' && item !== 'install' && !item.startsWith('-'))
    .filter((item) => isDeepSeekOfficialPackage(packageNameFromSpec(item)))
}

export function officialPluginUpdateVersion(args: readonly string[]): string | undefined {
  const action = pluginCommandAction(args)
  if (action !== 'add' && action !== 'update' && action !== 'install') return undefined
  const specs = officialPluginCommandSpecs(args).filter(item => isOfficialDshPackage(packageNameFromSpec(item)))
  if (specs.length === 0) return undefined
  const preferred = specs.find((item) => packageNameFromSpec(item) === '@deepseek-ai/dsh') ?? specs[0]
  if (preferred === undefined) return undefined
  const name = packageNameFromSpec(preferred)
  const version = preferred.slice(name.length).replace(/^@/, '')
  return version === '' ? OFFICIAL_DSH_VERSION : version
}

/** add/update 必须能在 profile 里解析到包，才算安装成功并允许热重启。 */
export function shouldRecycleAfterPluginResult(
  args: readonly string[],
  isInstalled: (packageName: string) => boolean,
  beforeProfileState?: string,
  afterProfileState?: string,
): boolean {
  const action = pluginCommandAction(args)
  if (action === 'other') return false
  const names = pluginCommandPackageNames(args)
  if (action !== 'remove' && names.length > 0 && !names.every((name) => isInstalled(name))) return false
  if (beforeProfileState !== undefined && afterProfileState !== undefined) return beforeProfileState !== afterProfileState
  if (action === 'remove') return true
  if (names.length === 0) return true
  return true
}

/** 仅比较本次命令涉及的运行时状态，避免 pnpm 未替换版本时误重载 DSH。 */
function profilePackageState(profileDir: string, packageNames: readonly string[]): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    const dependencies = manifest.dependencies ?? {}
    const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
    return JSON.stringify(packageNames.map((name) => ({
      name,
      dependency: dependencies[name],
      bundled: bundles.has(name),
      version: installedPackageVersion(profileDir, name),
    })))
  } catch {
    return undefined
  }
}

function installedPackageVersion(profileDir: string, packageName: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

export function createDesktopHostServices(options: DesktopHostOptions) {
  const runPlugin = (args: readonly string[], _invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle => {
    const officialSpecs = officialPluginCommandSpecs(args)
    const communitySpecs = pluginCommandPackageNames(args).filter(name => !isDeepSeekOfficialPackage(name))
    if (officialSpecs.length > 0 && communitySpecs.length > 0) {
      return completedPnpmHandle(1, '不能在同一条命令中混合安装官方包和社区包，请分别操作。\n')
    }
    const officialVersion = officialPluginUpdateVersion(args)
    if (officialVersion !== undefined && options.desktopRuntimeDir !== undefined) {
      writeOfficialRuntimeManifest(options.desktopRuntimeDir, officialVersion)
      const handle = (options.runner ?? runBundledPnpm)(officialRuntimeInstallArgs(options.desktopRuntimeDir), options.desktopRuntimeDir, signal)
      void handle.done.then(async (outcome) => {
        if (outcome.exitCode !== 0) return
        const delay = options.recycleDelayMs ?? 400
        setTimeout(() => {
          options.send?.(APPLY_PLUGIN_UPDATES_IPC)
        }, delay).unref?.()
      }).catch(error => { console.error('官方运行时更新后处理失败。', error) })
      return handle
    }
    if (officialSpecs.length > 0) {
      const message = pluginCommandAction(args) === 'remove'
        ? '官方运行时由桌面端统一管理，不能从插件市场卸载。\n'
        : '官方依赖随桌面运行时统一更新，不能单独安装到 Web profile。\n'
      return completedPnpmHandle(1, message)
    }
    const packageNames = pluginCommandPackageNames(args)
    const beforeProfileState = packageNames.length === 0 ? undefined : profilePackageState(options.profileDir, packageNames)
    const handle = (options.runner ?? runBundledPnpm)(args, options.profileDir, signal)
    void handle.done.then(async (outcome) => {
      if (outcome.exitCode !== 0 || pluginCommandAction(args) === 'other') return
      const isInstalled = options.isInstalled ?? ((packageName) => existsSync(join(options.profileDir, 'node_modules', ...packageName.split('/'), 'package.json')))
      await finalizeProfileBundlesAfterInstall(options.profileDir, [], packageNames.length === 0 ? undefined : packageNames)
      const afterProfileState = packageNames.length === 0 ? undefined : profilePackageState(options.profileDir, packageNames)
      if (!shouldRecycleAfterPluginResult(args, isInstalled, beforeProfileState, afterProfileState)) return
      const delay = options.recycleDelayMs ?? 400
      setTimeout(() => {
        options.send?.(APPLY_PLUGIN_UPDATES_IPC)
      }, delay).unref?.()
    }).catch(error => { console.error('插件安装后处理失败。', error) })
    return handle
  }
  const roots = options.profileRoots ?? resolveProfileRoots({
    home: options.profileName ? join(options.profileDir, '..', '..') : undefined,
    stateDir: dirname(options.profileDir),
  })
  const activeName = readActiveProfile(roots)
  let requestSeq = 0
  const nextRequestId = (): string => `p${String(++requestSeq)}-${Date.now().toString(36)}`
  /** Run a profile op via main; falls back to fire-and-forget without a channel. */
  const runProfileOp = async (
    type: DesktopProfileActionMessage['type'],
    name: string,
  ): Promise<void> => {
    assertProfileName(name)
    if (options.request !== undefined) {
      // Creating a profile seeds it (pnpm install) and legitimately takes a
      // while; a select relaunches almost immediately. Wait accordingly, and
      // never hang the HTTP response forever.
      const timeoutMs = type === 'desktop/profile/create' ? 120_000 : 5_000
      try {
        await options.request({ type, requestId: nextRequestId(), name } as DesktopProfileActionMessage, timeoutMs)
      } catch (error) {
        console.warn(`桌面 profile 操作等待主进程确认失败（${type}）：`, error instanceof Error ? error.message : error)
      }
      return
    }
    // Legacy fire-and-forget (no reply channel available).
    options.send?.({ type, requestId: nextRequestId(), name })
  }
  return {
    desktopProfiles: {
      connected: true,
      current: {
        name: options.profileName,
        dir: options.profileDir,
        connected: true,
      },
      active: activeName,
      list() {
        // Re-read the active profile so a switch performed by main is reflected.
        const active = readActiveProfile(roots)
        return listProfiles(roots, active).map((profile) => toDesktopProfileBridgeView(profile, active))
      },
      async create(name: string) {
        await runProfileOp('desktop/profile/create', name)
      },
      async select(name: string) {
        await runProfileOp('desktop/profile/select', name)
      },
      async delete(name: string) {
        assertProfileName(name)
        // Deleting a profile is a pure filesystem operation the bridge can do
        // here, instantly and synchronously with the request — no main-process
        // round-trip is needed. Main is only notified afterwards so its own
        // state (window/registry) stays consistent.
        deleteProfileDirectory(roots, name, readActiveProfile(roots))
        options.send?.({ type: 'desktop/profile/delete', requestId: nextRequestId(), name })
      },
      canDelete(name: string) {
        return isSafeProfileName(name) && name !== readActiveProfile(roots)
      },
    },
    desktopPnpm: {
      connected: true,
      run(args: readonly string[], signal?: AbortSignal): DesktopPnpmHandle {
        return runPlugin(args, options.profileDir, signal)
      },
      runPlugin,
    },
    // Launcher-native side effects the settings plugin may drive. Each method
    // forwards to the Electron main over IPC because the renderer/web-profile
    // process cannot open terminals, toggle DevTools, or relaunch itself.
    desktopRuntime: {
      connected: true,
      requestRestart(): void {
        options.send?.({ type: 'desktop/action/restart' })
      },
      openTerminal(): void {
        options.send?.({ type: 'desktop/action/terminal/open' })
      },
      toggleDeveloperTools(): void {
        options.send?.({ type: 'desktop/action/devtools/toggle' })
      },
    },
  }
}
export function runBundledPnpm(args: readonly string[], cwd: string, signal?: AbortSignal, timeoutMs = 300_000): DesktopPnpmHandle {
  const pnpmEntry = process.env.DSH_PNPM_ENTRY ?? process.env.npm_execpath
  if (pnpmEntry === undefined || !existsSync(pnpmEntry)) {
    return completedPnpmHandle(127, '未找到 pnpm 入口，无法执行插件操作。\n')
  }
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const storeDir = process.env.DSH_PNPM_STORE_DIR
  const effectiveArgs = storeDir === undefined || args.some(arg => arg === '--store-dir' || arg.startsWith('--store-dir=')) ? args : [...args, `--store-dir=${storeDir}`]
  const child: ChildProcess = spawn(process.execPath, [pnpmEntry, ...effectiveArgs], {
    cwd,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
    let settled = false
    let timedOut = false
    let killDeadline: ReturnType<typeof setTimeout> | undefined
    const finish = (exitCode: number | null, exitSignal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(killDeadline)
      stdout.end()
      stderr.end()
      resolvePromise({ exitCode, signal: exitSignal })
    }
    const timeout = setTimeout(() => {
      timedOut = true
      stderr.write('pnpm 操作超时，已终止子进程。\n')
      terminateProcessTree(child)
      killDeadline = setTimeout(() => finish(124, null), 2_000)
    }, timeoutMs)
    timeout.unref?.()
    child.once('error', () => finish(127, null))
    child.once('exit', (code, exitSignal) => timedOut ? finish(124, null) : finish(code, exitSignal))
    signal?.addEventListener('abort', () => terminateProcessTree(child), { once: true })
  })
  return {
    stdout,
    stderr,
    done,
    cancel: () => { terminateProcessTree(child) },
  }
}

function completedPnpmHandle(exitCode: number, message = ''): DesktopPnpmHandle {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  queueMicrotask(() => {
    stdout.end()
    stderr.end(message)
  })
  return {
    stdout,
    stderr,
    done: Promise.resolve({ exitCode, signal: null }),
    cancel: () => undefined,
  }
}

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DESKTOP_BRIDGE_FILES = [
  'desktop-bridge.mjs',
  'desktop-bridge-client-source.js',
  'atomic-file.js',
  'desktop-host.js',
  'bundled-plugins.js',
  'dsh-process.js',
  'plugin-seed.js',
  'plugin-toolchain.js',
  'profile-updates.js',
  'profiles.js',
  'recovery-mode.js',
  'process-control.js',
  'readiness.js',
  'runtime-archive.js',
  'runtime-prebuilt.js',
] as const

export function resolveDesktopBridgeDir(options: { isPackaged: boolean; appPath: string; resourcesPath: string }): string {
  return options.isPackaged
    ? join(options.resourcesPath, 'desktop-bridge')
    : join(options.appPath, 'dist', 'src')
}

/** 在 Desktop 私有目录准备完整桥接包，返回仅供本次启动使用的 overlay 路径。 */
export function prepareDesktopBridge(destDir: string, sourceDir: string): string {
  mkdirSync(destDir, { recursive: true })
  for (const file of DESKTOP_BRIDGE_FILES) {
    const from = join(sourceDir, file)
    if (!existsSync(from)) throw new Error(`桌面桥接文件缺失：${from}`)
    copyFileSync(from, join(destDir, file))
  }
  writeFileSync(join(destDir, 'desktop-bridge-client.js'), desktopBridgeClientBundle(), 'utf8')
  writeFileSync(join(destDir, 'package.json'), `${JSON.stringify({
    name: DESKTOP_BRIDGE_PACKAGE,
    version: '0.0.0-desktop',
    type: 'module',
    main: 'desktop-bridge.mjs',
    exports: {
      '.': './desktop-bridge.mjs',
      './client': './desktop-bridge-client.js',
      './package.json': './package.json',
    },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: {
        inject: [
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-runtime',
          '@deepseek-ai/dsh-client-ui-conversation',
          '@deepseek-ai/dsh-client-ui-layout',
          '@deepseek-ai/dsh-client-ui-workspace',
        ],
        platform: 'web',
      },
    },
  }, undefined, 2)}\n`, 'utf8')
  writeFileSync(join(destDir, 'cordis.patch.yml'), '[]\n', 'utf8')
  const patchPath = join(destDir, 'desktop.patch.yml')
  // JSON 是合法 YAML；file URL 同时兼容 Windows 路径、空格及中文目录。
  writeFileSync(patchPath, `${JSON.stringify([{ insert: [{
    id: DESKTOP_BRIDGE_PACKAGE,
    name: pathToFileURL(join(destDir, 'desktop-bridge.mjs')).href,
  }] }], undefined, 2)}\n`, 'utf8')
  return patchPath
}
