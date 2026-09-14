import { spawn, type ChildProcess } from 'node:child_process'

import { prependPath } from '../runtime/plugin-toolchain.js'
import { parseReadyUrl } from '../infra/readiness.js'
import { terminateProcessTree } from '../infra/process-control.js'
import { DEFAULT_PROFILE_NAME } from '../profiles/profiles.js'
import type { DshRuntime } from '../runtime/runtime.js'

const startupTimeoutMs = 45_000
const maxCapturedOutputLength = 12_000
/**
 * 单次健康探测的请求超时。
 *
 * 原来这里是 1 秒。冷启动时服务器可能长时间占着事件循环（装配插件、清理 pnpm store），
 * 于是每一次探测都超时——一个「慢」的启动就这样被判成「坏」的启动。真正限制启动时长的
 * 是下面那个总窗口，而不是单次请求，所以放宽这一项不会拖长失败判定。
 */
const healthProbeTimeoutMs = 3_000
/** 失败时随错误一起写进日志的子进程输出上限（日志不是倾倒场）。 */
const maxFailureOutputLength = 4_000
const shutdownTimeoutMs = 5_000
const forcedShutdownDeadlineMs = 2_000

export interface DshServer {
  stop: () => Promise<void>
  url: string
  /** Send a message to the DSH child over its IPC channel (no-op if closed). */
  send: (message: unknown) => void
}

export interface StartDshOptions {
  bootstrapPath: string
  /** Extra `--patch` overlay paths applied on top of the profile (desktop bridge, bundled plugins, …). */
  patches?: readonly string[]
  /** Profile name to boot via `--profile <name>` (defaults to `web`). */
  profileName?: string
  environment?: NodeJS.ProcessEnv
  onUnexpectedExit?: (message: string) => void
  onIpcMessage?: (message: unknown) => void
  pathPrefix?: string
  workingDirectory?: string
  runtime: DshRuntime
  nodeExecutable: string
  startupTimeoutMs?: number
}

/** 桌面窗口已经承载 Web UI，禁止官方 dsh-web-app 再拉起系统浏览器。 */
export const DSH_WEB_LAUNCH_ARGS = ['web', '--port', resolveDesktopWebPort(process.env.DSH_DESKTOP_WEB_PORT), '--no-open'] as const

/**
 * Web app flags appended after the profile selection. `--port 0` lets the OS
 * pick a free port; `--no-open` keeps the desktop window as the only host.
 */
function webAppArgs(): readonly string[] {
  return ['--port', resolveDesktopWebPort(process.env.DSH_DESKTOP_WEB_PORT), '--no-open']
}

export function resolveDesktopWebPort(value: string | undefined): string {
  if (value === undefined || !/^\d+$/.test(value)) return '0'
  const port = Number(value)
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? String(port) : '0'
}

/** 启动 DSH Web，并在收到本机就绪地址后返回。 */
export function startDsh(options: StartDshOptions): Promise<DshServer> {
  const patches = options.patches ?? []
  const patchArgs = patches.flatMap(patch => ['--patch', patch])
  // Select the profile explicitly with `--profile <name>`: the bare `web`
  // subcommand is a hardcoded alias for `--profile web`, so it can only ever
  // boot the `web` profile and would ignore a selected profile (e.g. `desktop`).
  // Profile selection MUST come before `--patch` and the web app's own flags.
  const profileName = options.profileName ?? DEFAULT_PROFILE_NAME
  const launchArgs = ['--profile', profileName, ...patchArgs, ...webAppArgs()]
  const child = spawn(options.nodeExecutable, [options.bootstrapPath, options.runtime.entry, ...launchArgs], {
    cwd: options.workingDirectory ?? options.runtime.workingDirectory ?? options.runtime.root,
    env: {
      ...process.env,
      ...options.environment,
      DSH_DESKTOP_HOST: patchArgs.length === 0 ? undefined : '1',
      ...(options.pathPrefix === undefined ? {} : {
        PATH: prependPath(options.environment?.PATH ?? process.env.PATH, options.pathPrefix),
      }),
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })

  return waitForReady(child, options.startupTimeoutMs ?? startupTimeoutMs)
    .then(url => createServer(child, url, options.onUnexpectedExit, options.onIpcMessage))
}

function waitForReady(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let capturedOutput = ''
    let checkingHealth = false
    let settled = false
    let timeout: ReturnType<typeof setTimeout>
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void stopChild(child).then(() => reject(error), () => reject(error))
    }
    const capture = (chunk: Buffer): void => {
      capturedOutput = (capturedOutput + chunk.toString('utf8')).slice(-maxCapturedOutputLength)
      const url = parseReadyUrl(capturedOutput)
      if (url === undefined || checkingHealth) return
      checkingHealth = true
      clearTimeout(timeout)
      void waitForHttpHealth(url, timeoutMs)
        .then(() => finish(() => resolve(url)))
        .catch(reason => fail(new Error(formatHealthCheckFailure(url, reason, capturedOutput))))
    }
    timeout = setTimeout(() => {
      fail(new Error('DSH 启动超时。'))
    }, timeoutMs)

    if (child.stdout === null || child.stderr === null) {
      fail(new Error('DSH 无法建立标准输出管道。'))
      return
    }

    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    child.once('error', () => fail(new Error('DSH 无法启动。')))
    child.once('exit', code => {
      if (settled) return
      finish(() => reject(new Error(formatEarlyExitMessage(code, capturedOutput))))
    })
  })
}

function createServer(child: ChildProcess, url: string, onUnexpectedExit?: (message: string) => void, onIpcMessage?: (message: unknown) => void): DshServer {
  let stopping = false
  let stopPromise: Promise<void> | undefined

  child.on('message', message => { onIpcMessage?.(message) })
  child.once('exit', (code, signal) => {
    if (!stopping) onUnexpectedExit?.(`DSH 运行中断（退出码 ${code ?? '未知'}，信号 ${signal ?? '无'}）。`)
  })

  return {
    url,
    send: (message: unknown) => {
      if (child.connected && typeof child.send === 'function') {
        // The IPC channel only carries serializable values; callers pass plain
        // JSON-shaped messages (profile/action requests and results).
        child.send(message as Parameters<ChildProcess['send']>[0], () => { /* ignore a closed-channel callback error */ })
      }
    },
    stop: () => {
      stopping = true
      stopPromise ??= stopChild(child)
      return stopPromise
    },
  }
}

/** 通过 IPC 请求上游 DSH 优雅退出，超时后才强制结束本启动器创建的 PID。 */
function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()

  return new Promise(resolve => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(forceTimer)
      clearTimeout(deadlineTimer)
      resolve()
    }
    const deadlineTimer = setTimeout(finish, shutdownTimeoutMs + forcedShutdownDeadlineMs)
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) terminateProcessTree(child)
    }, shutdownTimeoutMs)

    child.once('exit', finish)
    if (child.connected && child.send !== undefined) {
      child.send('shutdown', error => {
        if (error !== null) terminateProcessTree(child)
      })
      return
    }
    child.kill('SIGTERM')
  })
}

function formatEarlyExitMessage(code: number | null, capturedOutput: string): string {
  const detail = capturedOutput.replace(/\s+/g, ' ').trim()
  return detail === ''
    ? `DSH 提前退出（退出码 ${code ?? '未知'}）。`
    : `DSH 提前退出（退出码 ${code ?? '未知'}）。${detail}`
}

async function waitForHttpHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  // 最后一次探测的结果随失败一起上报：没有它，日志里只剩「未通过健康检查」，
  // 而究竟是连不上、还是服务器答了 401/500，完全看不出来。
  let lastProbe = '一次探测都没有完成'
  while (Date.now() < deadline) {
    try {
      // alpha.2+ 的 token URL 会先 303 并用 Set-Cookie 建立浏览器会话。
      // Node fetch 不保存 Cookie；若自动跟随，会在第二跳得到 401，因此这里手动检查首跳。
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(healthProbeTimeoutMs, Math.max(1, deadline - Date.now()))),
      })
      const healthy = response.ok || isAuthenticatedBootstrapRedirect(url, response)
      lastProbe = `HTTP ${response.status}`
      await response.body?.cancel()
      if (healthy) return
    } catch (error) {
      // 就绪行可能早于 HTTP 监听完成，超时前继续轮询。
      lastProbe = error instanceof Error ? `${error.name}：${error.message}` : String(error)
    }
    await new Promise<void>(resolve => setTimeout(resolve, 50))
  }
  throw new Error(lastProbe)
}

/**
 * 组装健康检查失败的错误文案，并把子进程输出一起带上。
 *
 * WHY THE DETAIL RIDES ALONG
 * --------------------------
 * 这是唯一一种「原因不写在别处」的启动失败：子进程还活着，而且已经打印过就绪地址，
 * 所以既没有退出码可读，也没有崩溃现场可看。原先这里把 capturedOutput 直接丢掉，
 * `.dsh-desktop-startup-error.log` 只剩一句话，只能靠手工复现去查服务器到底答了什么。
 *
 * 文案刻意是多行的：`reportStartupFailure` 会把整条写进日志，窗口里只显示第一行，
 * 所以诊断细节既不丢，也不会糊满界面。
 */
function formatHealthCheckFailure(url: string, reason: unknown, capturedOutput: string): string {
  const lines = [
    'DSH 启动失败：本机 HTTP 服务未通过健康检查。',
    `就绪地址：${url}`,
    `最后一次探测：${reason instanceof Error ? reason.message : String(reason)}`,
  ]
  const output = capturedOutput.slice(-maxFailureOutputLength).trim()
  if (output !== '') lines.push('—— DSH 输出（尾部）——', output)
  return lines.join('\n')
}

export function isAuthenticatedBootstrapRedirect(url: string, response: Response): boolean {
  if (response.status < 300 || response.status > 399 || !response.headers.has('set-cookie')) return false
  const source = new URL(url)
  if (!source.searchParams.has('token')) return false
  const location = response.headers.get('location')
  if (location === null) return false
  const target = new URL(location, source)
  return target.origin === source.origin && target.protocol === 'http:' && target.hostname === '127.0.0.1'
}
