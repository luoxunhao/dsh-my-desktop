/**
 * dsh-my-desktop-setting — Host (Node) entry.
 *
 * A standard third-party DSH settings plugin that runs inside a DSH profile
 * (target: the `web` profile that dsh-my-desktop launches), same origin as the
 * browser client. It registers the `/api/dsh-my-settings/*` HTTP surface on
 * `ctx.webServer` and persists its self-consistent preferences in an explicit
 * plugin-owned JSON state file (never `process.cwd()`).
 *
 * Honesty contract with the launcher: this plugin is NOT the Electron launcher.
 * Preference rows that a plain DSH profile can persist are implemented here;
 * Host-专属 rows (restart, profile switch, open terminal, Developer Tools,
 * diagnostics export, native window material / LAN) are capability-gated and
 * answered with HTTP 501 + a stable `capability` code when the running profile
 * exposes no launcher service for them — never faked.
 *
 * @module dsh-my-desktop-setting
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { settingsPaths } from './contract.js'
import type { SettingsCapabilityToken, SettingsProfileView } from './contract.js'
import type { HostServiceAccess, ProfileBridgeItem } from './host-capability.js'
import { DesktopSettingsController } from './host-controller.js'
import type { HostActionPorts } from './host-controller.js'
import {
  handleAaSelect,
  handleAppearanceUpdate,
  handleHostAction,
  handleMarketSelect,
  handleNotificationsUpdate,
  handleProfileCreate,
  handleProfileDelete,
  handleProfileSwitch,
  handleState,
} from './http-handlers.js'
import { SettingsStateStore, resolveStateFilePaths } from './state-store.js'

/** Stable Cordis plugin name (matches the package / patch row name). */
export const name = 'dsh-my-desktop-setting'

/**
 * Services this plugin requires to serve its HTTP surface. Host-specific
 * capability services are probed via `ctx.get` and never required.
 */
export const inject = ['webServer'] as const

/** Validated configuration (kept minimal and dependency-free; not schema-validated). */
export interface Config {
  /**
   * Whether the HTTP surface is enabled. Absent config (the patch default `{}`)
   * means enabled; only an explicit `false` disables.
   */
  readonly enabled?: boolean
}

/** Narrow structural view of the `ctx.webServer` route surface. */
interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

type CordisContext = Context

/**
 * Read an optional Cordis service without declaring it in `inject`. Cordis
 * Contexts are proxies that throw on any non-injected service property access;
 * catching that throw is the only portable way to probe a service that may or
 * may not be provided by a given host.
 */
function tryReadService(ctx: CordisContext, name: string): unknown {
  try {
    return (ctx as unknown as Record<string, unknown>)[name]
  } catch {
    // Cordis rejects access to a service not declared in `inject`; treat that
    // as "not provided by this host" rather than failing the whole plugin.
    return undefined
  }
}

/** Parse one bridge `list()` result into renderer-safe profile bridge items. */
function readProfileItems(listFn: (() => unknown) | undefined): ProfileBridgeItem[] | undefined {
  if (listFn === undefined) return undefined
  try {
    const raw = listFn()
    if (!Array.isArray(raw)) return undefined
    return raw
      .map((item): ProfileBridgeItem | undefined => {
        if (!isServiceRecord(item)) return undefined
        const name = item['name']
        if (typeof name !== 'string' || name.length === 0) return undefined
        return {
          name,
          ...(typeof item['current'] === 'boolean' ? { current: item['current'] as boolean } : {}),
          ...(typeof item['connected'] === 'boolean' ? { connected: item['connected'] as boolean } : {}),
          ...(typeof item['exists'] === 'boolean' ? { exists: item['exists'] as boolean } : {}),
          ...(typeof item['webCapable'] === 'boolean' ? { webCapable: item['webCapable'] as boolean } : {}),
          ...(typeof item['selectable'] === 'boolean' ? { selectable: item['selectable'] as boolean } : {}),
          ...(typeof item['deletable'] === 'boolean' ? { deletable: item['deletable'] as boolean } : {}),
        }
      })
      .filter((item): item is ProfileBridgeItem => item !== undefined)
  } catch {
    // A failing list() must not break the whole read projection.
    return undefined
  }
}

/** Read optional launcher capability services off ctx, duck-typed. */
function probeHost(ctx: CordisContext): HostServiceAccess {
  const profiles = tryReadService(ctx, 'desktopProfiles')
  const pnpm = tryReadService(ctx, 'desktopPnpm')
  const runtime = tryReadService(ctx, 'desktopRuntime')
  const env = process.env
  const profileRecord = isServiceRecord(profiles) ? profiles : null
  const listFn = profileRecord !== null && typeof profileRecord['list'] === 'function'
    ? profileRecord['list'] as () => unknown
    : undefined
  const profileList = readProfileItems(listFn)
  const selectFn = profileRecord !== null && typeof profileRecord['select'] === 'function'
    ? (name: string): void | Promise<void> => (profileRecord['select'] as (n: string) => unknown)(name) as void | Promise<void>
    : undefined
  const createFn = profileRecord !== null && typeof profileRecord['create'] === 'function'
    ? (name: string): void | Promise<void> => (profileRecord['create'] as (n: string) => unknown)(name) as void | Promise<void>
    : undefined
  const deleteFn = profileRecord !== null && typeof profileRecord['delete'] === 'function'
    ? (name: string): void | Promise<void> => (profileRecord['delete'] as (n: string) => unknown)(name) as void | Promise<void>
    : undefined
  return {
    desktopEnv: env.DSH_DESKTOP_HOST === '1',
    desktopProfiles: profileRecord !== null ? { connected: profileRecord['connected'] === true } : null,
    desktopPnpm: isServiceRecord(pnpm) ? { connected: pnpm['connected'] === true } : null,
    desktopRuntime: runtime !== undefined && runtime !== null ? runtime : null,
    profileName: env.DSH_PROFILE_NAME ?? null,
    hasProfileDirectory:
      (env.DSH_PROFILE_DIR !== undefined && env.DSH_PROFILE_DIR.length > 0)
      || (env.DSH_HOME !== undefined && env.DSH_HOME.length > 0),
    ...(profileList !== undefined ? { profileList } : {}),
    // Live provider: re-reads the bridge on every read() so a create/delete is
    // reflected immediately (no app restart / plugin re-apply needed).
    ...(listFn === undefined ? {} : { listProfiles: () => readProfileItems(listFn) }),
    ...(selectFn !== undefined ? { selectProfile: selectFn } : {}),
    ...(createFn !== undefined ? { createProfile: createFn } : {}),
    ...(deleteFn !== undefined ? { deleteProfile: deleteFn } : {}),
  }
}

function isServiceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Detect launcher-only action forwarders that a Desktop host may expose on
 * `ctx` (e.g. the dsh-desktop Electron runtime). dsh-my-desktop's own bridge
 * exposes none of these, so in that target every Host-专属 row stays declined.
 */
function probeLauncherPorts(ctx: CordisContext): HostActionPorts {
  const ports: {
    requestRestart?: () => Promise<void>
    openTerminal?: () => void
    toggleDeveloperTools?: () => void
    exportDiagnostics?: () => Promise<void>
  } = {}
  const callWithReceiver = (receiver: Record<string, unknown>, key: string): (() => unknown) => {
    const method = receiver[key] as ((...args: unknown[]) => unknown) | undefined
    return method === undefined ? (): unknown => undefined : (): unknown => method.call(receiver)
  }
  for (const candidate of [tryReadService(ctx, 'desktopRuntime'), tryReadService(ctx, 'desktopSettingsController')]) {
    if (!isServiceRecord(candidate)) continue
    if (typeof candidate['requestRestart'] === 'function') {
      const call = callWithReceiver(candidate, 'requestRestart')
      ports.requestRestart = async (): Promise<void> => { await call() }
    }
    if (typeof candidate['openTerminal'] === 'function') {
      const call = callWithReceiver(candidate, 'openTerminal')
      ports.openTerminal = (): void => { call() }
    }
    if (typeof candidate['toggleDeveloperTools'] === 'function') {
      const call = callWithReceiver(candidate, 'toggleDeveloperTools')
      ports.toggleDeveloperTools = (): void => { call() }
    }
    if (typeof candidate['exportDiagnostics'] === 'function') {
      const call = callWithReceiver(candidate, 'exportDiagnostics')
      ports.exportDiagnostics = async (): Promise<void> => { await call() }
    }
  }
  return ports as HostActionPorts
}

/** Map each Host-专属 endpoint to the capability token it gates on. */
const HOST_ACTION_TOKENS: ReadonlyArray<readonly [string, SettingsCapabilityToken]> = Object.freeze([
  [settingsPaths.restart, 'host.restart'],
  [settingsPaths.terminalOpen, 'host.open-terminal'],
  [settingsPaths.devtoolsToggle, 'host.devtools'],
  [settingsPaths.diagnosticsExport, 'host.diagnostics-export'],
])

/**
 * Apply the plugin: build the state store + controller and register every HTTP
 * route. All long-lived registrations are owned by `ctx.effect` disposers.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  const webServer = (ctx as unknown as { webServer?: WebServerLike }).webServer
  if (webServer === undefined || typeof webServer.register !== 'function') {
    ctx.logger.error('dsh-my-desktop-setting: ctx.webServer is unavailable; skipping HTTP surface')
    return
  }

  const { directory, filePath } = resolveStateFilePaths()
  const store = new SettingsStateStore(directory, filePath)
  const hostAccess = probeHost(ctx)
  const launcherPorts = probeLauncherPorts(ctx)
  const controller = new DesktopSettingsController(
    hostAccess,
    store,
    {
      ...launcherPorts,
      // A multi-profile launcher bridge exposes live profile operations.
      ...(hostAccess.selectProfile === undefined ? {} : { selectProfile: hostAccess.selectProfile }),
      ...(hostAccess.createProfile === undefined ? {} : { createProfile: hostAccess.createProfile }),
      ...(hostAccess.deleteProfile === undefined ? {} : { deleteProfile: hostAccess.deleteProfile }),
      // Live profile list: create/delete reflect on the very next read().
      ...(hostAccess.listProfiles === undefined ? {} : {
        listProfiles: () => (hostAccess.listProfiles?.() ?? []).map((item): SettingsProfileView => Object.freeze({
          name: item.name,
          current: item.current === true,
          bridgeConnected: hostAccess.desktopProfiles?.connected === true,
          hasDirectory: hostAccess.hasProfileDirectory,
          ...(item.exists === undefined ? {} : { exists: item.exists }),
          ...(item.webCapable === undefined ? {} : { webCapable: item.webCapable }),
          ...(item.selectable === undefined ? {} : { selectable: item.selectable }),
          ...(item.deletable === undefined ? {} : { deletable: item.deletable }),
        })),
      }),
    },
  )

  const reportError = (operation: string, cause: unknown): void => {
    ctx.logger.error(
      `dsh-my-desktop-setting: ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const handlerCtx = { controller, reportError }

  const routes: ReadonlyArray<readonly [string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>]> = [
    [settingsPaths.state, handleState(handlerCtx)],
    [settingsPaths.marketSelect, handleMarketSelect(handlerCtx)],
    [settingsPaths.aaSelect, handleAaSelect(handlerCtx)],
    [settingsPaths.notificationsUpdate, handleNotificationsUpdate(handlerCtx)],
    [settingsPaths.appearanceUpdate, handleAppearanceUpdate(handlerCtx)],
    // Profile management (create/select/delete) is a real launcher operation.
    [settingsPaths.profileCreate, handleProfileCreate(handlerCtx)],
    [settingsPaths.profileSwitch, handleProfileSwitch(handlerCtx)],
    [settingsPaths.profileDelete, handleProfileDelete(handlerCtx)],
  ]

  for (const [path, handler] of routes) {
    const disposer = webServer.register({ kind: 'exact', path, handler })
    ctx.effect(() => disposer, `dsh-my-desktop-setting: route ${path}`)
  }

  for (const [path, token] of HOST_ACTION_TOKENS) {
    const disposer = webServer.register({ kind: 'exact', path, handler: handleHostAction(handlerCtx, token) })
    ctx.effect(() => disposer, `dsh-my-desktop-setting: host action route ${path}`)
  }
}
