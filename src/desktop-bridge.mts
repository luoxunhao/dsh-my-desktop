import { homedir } from 'node:os'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createDesktopHostServices } from './desktop-host.js'

export const name = 'dsh-desktop-bridge'

interface CordisLike {
  provide?(name: string, value?: unknown): void
  set?(name: string, value: unknown): void
  root?: CordisLike
  [key: string]: unknown
}

/** 向 DSH 提供官方桌面契约，让插件市场走随包 pnpm，并由桌面端负责热更新。 */
export function apply(ctx: CordisLike): void {
  // 共享 profile 或继承环境变量不代表存在 Desktop 宿主与可用的安装工具。
  if (process.env.DSH_DESKTOP_HOST !== '1' || !process.connected || typeof process.send !== 'function') return
  const pnpmEntry = process.env.DSH_PNPM_ENTRY
  if (!pnpmEntry || !existsSync(pnpmEntry)) return
  const profileDir = process.env.DSH_PROFILE_DIR ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'web')
  const host = createDesktopHostServices({
    profileName: process.env.DSH_PROFILE_NAME ?? 'web',
    profileDir,
    profileRoots: {
      home: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
      stateDir: process.env.DSH_PROFILE_SELECTION_DIR ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'launcher'),
    },
    ...(process.env.DSH_RUNTIME_DIR === undefined ? {} : { desktopRuntimeDir: process.env.DSH_RUNTIME_DIR }),
    send: typeof process.send === 'function' ? process.send.bind(process) : undefined,
  })

  // 运行标记，便于诊断桥是否执行到 provide。
  try {
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, '.dsh-desktop-bridge.marker.json'), JSON.stringify({
      ran: true,
      time: new Date().toISOString(),
      profileName: process.env.DSH_PROFILE_NAME ?? 'web',
      hasRoot: typeof (ctx as CordisLike).root === 'object' && (ctx as CordisLike).root !== null,
    }), 'utf8')
  } catch {
    // 标记写入失败不影响桥注入。
  }

  // 服务注册到应用的根 ctx（所有 loader 行的共享祖先），这样 `dsh-my-desktop-setting`
  // 等兄弟 overlay 插件也能读到 —— 单进程 Cordis ctx 通过原型继承暴露祖先 ctx 的服务。
  // 只注册一次，避免“service has been registered”重复注册崩溃。
  const target = ctx.root ?? ctx
  target.provide?.('desktopProfiles', host.desktopProfiles)
  target.provide?.('desktopPnpm', host.desktopPnpm)
  target.provide?.('desktopRuntime', host.desktopRuntime)
  try {
    target.set?.('desktopProfiles', host.desktopProfiles)
    target.set?.('desktopPnpm', host.desktopPnpm)
    target.set?.('desktopRuntime', host.desktopRuntime)
  } catch {
    // 部分宿主只允许 provide 写入，set 会因未预声明而抛错。
  }
  target.desktopProfiles = host.desktopProfiles
  target.desktopPnpm = host.desktopPnpm
  target.desktopRuntime = host.desktopRuntime
}
