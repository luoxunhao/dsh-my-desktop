/**
 * Host capability detection for dsh-my-desktop-setting.
 *
 * This plugin runs inside a DSH profile. It is NOT the Electron launcher, so a
 * capability is only "supported" when the running profile actually exposes the
 * service that can perform it. Detection never guesses from layout or package
 * presence; it probes concrete signals and returns an immutable manifest the
 * HTTP layer uses to answer Host-专属 endpoints with `capability: false`
 * (HTTP 501) instead of faking success.
 *
 * Signals probed (all optional, none required):
 *  - `process.env.DSH_DESKTOP_HOST === '1'`  -> Electron Desktop launcher hosts us.
 *  - `ctx.desktopProfiles` / `ctx.desktopPnpm` -> the dsh-my-desktop bridge.
 *  - `ctx.desktopRuntime` -> the dsh-desktop Electron shell adapter.
 *
 * @module dsh-my-desktop-setting/host-capability
 */

import type {
  SettingsAppearanceView,
  SettingsCapabilityToken,
  SettingsCapabilityView,
  SettingsMarketProvider,
  SettingsNotificationsView,
  SettingsProfileView,
} from './contract.js'

/** How far along a launcher's IPC/install tooling is. */
export type HostBridgeState =
  | 'unavailable'
  | 'offline'
  | 'ready'

/** One profile entry surfaced by a live `desktopProfiles` bridge. */
export interface ProfileBridgeItem {
  readonly name: string
  readonly current?: boolean
  readonly connected?: boolean
  readonly exists?: boolean
  readonly webCapable?: boolean
  readonly selectable?: boolean
  readonly deletable?: boolean
}

/** Narrow, duck-typed projection of the services a DSH host may expose. */
export interface HostServiceAccess {
  /** Electron-launched desktop profile? `DSH_DESKTOP_HOST=1` from the launcher. */
  readonly desktopEnv: boolean
  /** The dsh-my-desktop profile bridge (single active profile adapter). */
  readonly desktopProfiles: { readonly connected: boolean } | null
  /** The dsh-my-desktop pnpm plugin-market bridge. */
  readonly desktopPnpm: { readonly connected: boolean } | null
  /** The dsh-desktop Electron shell runtime adapter. */
  readonly desktopRuntime: unknown | null
  /** Current profile name the launcher selected, when known. */
  readonly profileName: string | null
  /** Whether an explicit profile directory is known (path never serialized). */
  readonly hasProfileDirectory: boolean
  /**
   * Live profile discovery facts from a real `desktopProfiles` bridge. When the
   * launcher manages multiple profiles, each recognized profile is listed so
   * the section can render/switch them truthfully.
   */
  readonly profileList?: readonly ProfileBridgeItem[]
  /** Live profile discovery: re-read on every read() (create/delete visible immediately). */
  readonly listProfiles?: () => readonly ProfileBridgeItem[] | undefined
  /** Forward an active-profile switch to the launcher (best-effort). */
  readonly selectProfile?: (name: string) => void | Promise<void>
  /** Create a new profile through the launcher bridge (best-effort). */
  readonly createProfile?: (name: string) => void | Promise<void>
  /** Delete an inactive profile through the launcher bridge (best-effort). */
  readonly deleteProfile?: (name: string) => void | Promise<void>
}

/** Renderer-safe capability facts for the currently running profile. */
export interface HostCapability {
  readonly desktopHost: boolean
  readonly profileBridgeState: HostBridgeState
  readonly pnpmBridgeState: HostBridgeState
  readonly runtimePresent: boolean
  /** Recognized profile(s); directory values are never serialized. */
  readonly profiles: readonly SettingsProfileView[]
  /** The native-shell-only preference the running host can apply. */
  readonly appearance: SettingsAppearanceView
}

/** Testable projection of the active profile discovery. */
export interface SettingsLoadedView {
  readonly current: string | null
  readonly market: {
    readonly requested: SettingsMarketProvider
    readonly effective: SettingsMarketProvider
    readonly legacyDefaulted: boolean
  }
  readonly aa: { readonly requested: boolean; readonly effective: boolean }
  readonly notifications: SettingsNotificationsView
  readonly appearance: SettingsAppearanceView
}

const MARKET_DEFAULT = 'disabled' as const

/** Whether a launcher bridge that performs a Host-专属 side effect is usable. */
function isReady(value: { readonly connected?: boolean } | null): boolean {
  return value !== null && value.connected === true
}

/**
 * Probe the running DSH process for launcher capabilities.
 * @param access - injected environment + service facts (unit-testable).
 */
export function detectHostCapability(access: HostServiceAccess): HostCapability {
  // Prefer the launcher's live profile registry when present; otherwise fall
  // back to the single env-derived current profile.
  const profiles: SettingsProfileView[] = []
  if (access.profileList !== undefined && access.profileList.length > 0) {
    for (const item of access.profileList) {
      if (typeof item.name !== 'string' || item.name.length === 0) continue
      profiles.push(Object.freeze({
        name: item.name,
        current: item.current === true,
        bridgeConnected: isReady(access.desktopProfiles),
        hasDirectory: access.hasProfileDirectory,
        ...(item.exists === undefined ? {} : { exists: item.exists }),
        ...(item.webCapable === undefined ? {} : { webCapable: item.webCapable }),
        ...(item.selectable === undefined ? {} : { selectable: item.selectable }),
        ...(item.deletable === undefined ? {} : { deletable: item.deletable }),
      }))
    }
  } else {
    const currentName = access.profileName
    if (currentName !== null && currentName.length > 0) {
      profiles.push(Object.freeze({
        name: currentName,
        current: true,
        bridgeConnected: isReady(access.desktopProfiles),
        hasDirectory: access.hasProfileDirectory,
      }))
    }
  }
  if (profiles.find(profile => profile.current) === undefined && access.profileName !== null) {
    profiles.push(Object.freeze({
      name: access.profileName,
      current: true,
      bridgeConnected: isReady(access.desktopProfiles),
      hasDirectory: access.hasProfileDirectory,
    }))
  }
  const profileBridge = isReady(access.desktopProfiles)
    ? 'ready' as const
    : access.desktopProfiles !== null
      ? 'offline' as const
      : 'unavailable' as const
  const pnpmBridge = isReady(access.desktopPnpm)
    ? 'ready' as const
    : access.desktopPnpm !== null
      ? 'offline' as const
      : 'unavailable' as const
  const base = {
    desktopHost: access.desktopEnv,
    profileBridgeState: profileBridge,
    pnpmBridgeState: pnpmBridge,
    runtimePresent: access.desktopRuntime !== null,
  }
  return Object.freeze({
    ...base,
    profiles: Object.freeze(profiles),
    appearance: effectiveAppearance(),
  })
}

/**
 * Native appearance is only livable in a Desktop host. In a plain web profile
 * the preference can still be *stored*, but the view reports it cannot take
 * effect here.
 */
function effectiveAppearance(): SettingsAppearanceView {
  // Host will overwrite `nativeCapable` from the true capability result; the
  // pure projection is assembled in `resolveAppearanceCapability`.
  return Object.freeze({
    material: 'off',
    mode: 'compatibility',
    nativeCapable: false,
  })
}

/** Whether the pnpm bridge is usable enough to persist-and-apply a market change. */
export function marketChangeSupported(cap: HostCapability): boolean {
  return cap.pnpmBridgeState === 'ready'
}

/** Whether the running host can apply native appearance (material / mode). */
export function nativeAppearanceSupported(cap: HostCapability): boolean {
  return cap.runtimePresent
}

/** Resolve the appearance view with the true capability flag. */
export function resolveAppearance(
  stored: SettingsAppearanceView,
  nativeSupported: boolean,
): SettingsAppearanceView {
  return Object.freeze({ ...stored, nativeCapable: nativeSupported })
}

/**
 * Build the per-token capability list the client uses to render each control.
 * Only reads and preference persistence are self-consistent; Host-专属 operations
 * are `supported` exactly when a real, wired launcher forwarder exists.
 * @param cap - detected host facts.
 * @param launcher - whether each launcher-only action has a usable forwarder.
 *   Defaults to the conservative inference: no forwarder unless the Electron
 *   runtime adapter is actually present.
 */
export function capabilityManifest(
  cap: HostCapability,
  launcher: LauncherActionSupport = inferLauncherSupport(cap),
): readonly SettingsCapabilityView[] {
  const list: SettingsCapabilityView[] = []
  const push = (
    token: SettingsCapabilityToken,
    supported: boolean,
    unsupportedCode: 'host.unsupported' | 'host.offline' | null,
    reason: string | null,
  ): void => {
    list.push(Object.freeze({ token, supported, unsupportedCode, reason }))
  }
  push('profile.discover', cap.profiles.length > 0, null, null)
  push('market.preference', true, null, null)
  push('aa.preference', true, null, null)
  push('notifications.preference', true, null, null)
  push('appearance.preference', true, null, null)

  const declineReason = (action: string): string =>
    cap.desktopHost
      ? `当前宿主不提供${action}（launcher 未暴露该服务）。`
      : '未检测到 Desktop 宿主。'

  push(
    'host.profile-switch',
    launcher.profileSwitch,
    launcher.profileSwitch ? null : cap.desktopHost ? 'host.unsupported' : 'host.offline',
    launcher.profileSwitch ? null : declineReason('活动 profile 切换'),
  )
  push(
    'host.restart',
    launcher.restart,
    launcher.restart ? null : cap.desktopHost ? 'host.unsupported' : 'host.offline',
    launcher.restart ? null : declineReason('应用重启'),
  )
  push(
    'host.open-terminal',
    launcher.terminal,
    launcher.terminal ? null : cap.desktopHost ? 'host.unsupported' : 'host.offline',
    launcher.terminal ? null : declineReason('DSH 终端'),
  )
  push(
    'host.devtools',
    launcher.devtools,
    launcher.devtools ? null : cap.desktopHost ? 'host.unsupported' : 'host.offline',
    launcher.devtools ? null : declineReason('开发者工具'),
  )
  push(
    'host.diagnostics-export',
    launcher.diagnostics,
    launcher.diagnostics ? null : cap.desktopHost ? 'host.unsupported' : 'host.offline',
    launcher.diagnostics ? null : declineReason('诊断导出'),
  )
  push(
    'host.web-and-material',
    cap.runtimePresent,
    cap.runtimePresent ? 'host.unsupported' : 'host.offline',
    cap.runtimePresent ? null : '运行环境不承载原生窗口（材质/LAN 只读）。',
  )
  return Object.freeze(list)
}

/** Which launcher-only actions have a usable forwarder in this host. */
export interface LauncherActionSupport {
  readonly restart: boolean
  readonly terminal: boolean
  readonly devtools: boolean
  readonly diagnostics: boolean
  readonly profileSwitch: boolean
}

/** Conservative default: none forwardable unless the Electron runtime adapter is present. */
export function inferLauncherSupport(cap: HostCapability): LauncherActionSupport {
  return {
    restart: cap.runtimePresent,
    terminal: cap.runtimePresent,
    devtools: cap.runtimePresent,
    diagnostics: cap.runtimePresent,
    profileSwitch: cap.runtimePresent,
  }
}

/** Find one capability view by token. */
export function findCapability(
  manifest: readonly SettingsCapabilityView[],
  token: SettingsCapabilityToken,
): SettingsCapabilityView | undefined {
  return manifest.find(view => view.token === token)
}

/** Stable default requested market provider. */
export function defaultMarketProvider(): SettingsMarketProvider {
  return MARKET_DEFAULT
}
