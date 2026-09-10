/**
 * Host controller for dsh-my-desktop-setting: assembles the renderer-safe read
 * projection, validates and persists self-consistent preference writes, and
 * answers Host-专属 actions with an explicit capability result so the HTTP layer
 * can respond `501` instead of pretending the launcher acted.
 *
 * @module dsh-my-desktop-setting/host-controller
 */

import type {
  DesktopRestartAcceptance,
  DesktopSettingsView,
  SettingsAaSelectRequest,
  SettingsAppearanceUpdateRequest,
  SettingsAppearanceView,
  SettingsCapabilityToken,
  SettingsCapabilityView,
  SettingsMarketSelectRequest,
  SettingsMarketProvider,
  SettingsNotificationsUpdateRequest,
  SettingsProfileView,
} from './contract.js'
import {
  capabilityManifest,
  defaultMarketProvider,
  detectHostCapability,
  marketChangeSupported,
  nativeAppearanceSupported,
  resolveAppearance,
  type HostCapability,
  type HostServiceAccess,
  type LauncherActionSupport,
  type SettingsLoadedView,
} from './host-capability.js'
import { SettingsStateStore, defaultState } from './state-store.js'
import type { SettingsState } from './state-store.js'

/** Inputs a Host-专属 operation may forward to, resolved lazily. */
export interface HostActionPorts {
  /** Optional full Electron runtime adapter (only the pure dsh-desktop shell). */
  readonly requestRestart?: () => Promise<void>
  readonly openTerminal?: () => void
  readonly toggleDeveloperTools?: () => void
  readonly exportDiagnostics?: () => Promise<void>
  /** Forward an active-profile switch to a multi-profile launcher bridge. */
  readonly selectProfile?: (name: string) => void | Promise<void>
  /** Create a new Web profile through the launcher bridge (no selection). */
  readonly createProfile?: (name: string) => void | Promise<void>
  /** Delete an inactive profile through the launcher bridge. */
  readonly deleteProfile?: (name: string) => void | Promise<void>
  /**
   * Live profile discovery: re-read the current profiles on every `read()` so a
   * create/delete performed through this controller shows up immediately,
   * without waiting for the plugin to be re-applied (an app restart).
   */
  readonly listProfiles?: () => readonly SettingsProfileView[]
}

/** Result of attempting a Host-专属 action. */
export type HostActionResult =
  | { readonly ok: true; readonly acceptance: DesktopRestartAcceptance | { readonly accepted: true } }
  | { readonly ok: false; readonly code: 'host.unsupported' | 'host.offline' | 'host.failed' }

const MARKET_PROVIDERS: readonly string[] = ['disabled', 'community-market', 'dsh-market']

function isMarketProvider(value: unknown): value is SettingsMarketProvider {
  return typeof value === 'string' && (MARKET_PROVIDERS as readonly string[]).includes(value)
}

/**
 * Project the persisted state plus live host facts into the wire view.
 * Directory and native paths never serialize; only booleans/names ride.
 */
export class DesktopSettingsController {
  private readonly state: SettingsStateStore
  private readonly capability: HostCapability
  private readonly ports: HostActionPorts

  constructor(
    access: HostServiceAccess,
    state: SettingsStateStore,
    ports: HostActionPorts = {},
  ) {
    this.state = state
    this.capability = detectHostCapability(access)
    this.ports = ports
  }

  /** The per-operation capability list (reflects the actually-wired forwarders). */
  capabilities(): readonly SettingsCapabilityView[] {
    return capabilityManifest(this.capability, this.launcherSupport())
  }

  /**
   * Switch the active profile through the launcher bridge. Returns `ok:false`
   * (never fakes) when no multi-profile bridge is available.
   */
  async selectProfile(name: string): Promise<HostActionResult> {
    const select = this.ports.selectProfile
    if (select === undefined) return unsupported(this.capability.desktopHost)
    try {
      await select(name)
      return { ok: true, acceptance: Object.freeze({ accepted: true, restartRequired: true }) }
    } catch {
      return { ok: false, code: 'host.failed' }
    }
  }

  /** Whether the launcher can create/switch/delete profiles. */
  get profileManagementSupported(): boolean {
    return this.ports.selectProfile !== undefined
      && (this.ports.createProfile !== undefined || this.ports.deleteProfile !== undefined)
  }

  /** Create a new Web profile through the launcher bridge (no selection). */
  async createProfile(name: string): Promise<HostActionResult> {
    const create = this.ports.createProfile
    if (create === undefined) return unsupported(this.capability.desktopHost)
    try {
      await create(name)
      return { ok: true, acceptance: Object.freeze({ accepted: true, restartRequired: false }) }
    } catch {
      return { ok: false, code: 'host.failed' }
    }
  }

  /** Delete an inactive profile through the launcher bridge. */
  async deleteProfile(name: string): Promise<HostActionResult> {
    const remove = this.ports.deleteProfile
    if (remove === undefined) return unsupported(this.capability.desktopHost)
    try {
      await remove(name)
      return { ok: true, acceptance: Object.freeze({ accepted: true, restartRequired: false }) }
    } catch {
      return { ok: false, code: 'host.failed' }
    }
  }

  /** Which launcher-only actions this controller can actually forward. */
  private launcherSupport(): LauncherActionSupport {
    return {
      restart: this.ports.requestRestart !== undefined,
      terminal: this.ports.openTerminal !== undefined,
      devtools: this.ports.toggleDeveloperTools !== undefined,
      diagnostics: this.ports.exportDiagnostics !== undefined,
      profileSwitch: this.ports.selectProfile !== undefined,
    }
  }

  /** Whether the plugin has a durable place to persist its preferences. */
  get persistenceAvailable(): boolean {
    return this.state.available
  }

  private loadedView(): SettingsLoadedView {
    const snapshot = this.state.snapshot()
    const appearance = resolveAppearance(
      snapshot.appearance,
      nativeAppearanceSupported(this.capability),
    )
    return {
      current: this.capability.profiles.find(profile => profile.current)?.name ?? null,
      market: {
        requested: snapshot.market.provider,
        effective: snapshot.market.provider,
        legacyDefaulted: !this.state.hasPersistedState
          && snapshot.market.provider === defaultMarketProvider(),
      },
      aa: {
        requested: snapshot.aa.enabled,
        effective: snapshot.aa.enabled,
      },
      notifications: snapshot.notifications,
      appearance,
    }
  }

  /** Assemble the full renderer-safe read projection. */
  read(): DesktopSettingsView {
    const loaded = this.loadedView()
    // Prefer a live profile list so create/delete reflect immediately; fall back
    // to the constructor-time snapshot when no live provider is wired.
    const profiles: readonly SettingsProfileView[] = this.ports.listProfiles?.() ?? this.capability.profiles
    const bridges = this.bridgeNames()
    const capabilities = this.capabilities()
    return Object.freeze({
      current: profiles.find(profile => profile.current)?.name ?? loaded.current,
      host: Object.freeze({
        desktopHost: this.capability.desktopHost,
        bridges: Object.freeze(bridges),
        profiles,
      }),
      market: Object.freeze({
        requested: loaded.market.requested,
        effective: loaded.market.effective,
        legacyDefaulted: loaded.market.legacyDefaulted,
      }),
      aa: Object.freeze({
        requested: loaded.aa.requested,
        effective: loaded.aa.effective,
      }),
      notifications: Object.freeze({
        enabled: loaded.notifications.enabled,
        events: Object.freeze({
          sessionEnd: loaded.notifications.events.sessionEnd,
          errors: loaded.notifications.events.errors,
          updates: loaded.notifications.events.updates,
          progress: loaded.notifications.events.progress,
        }),
      }),
      appearance: Object.freeze({
        material: loaded.appearance.material,
        mode: loaded.appearance.mode,
        nativeCapable: loaded.appearance.nativeCapable,
      }),
      capabilities,
    })
  }

  private bridgeNames(): readonly ('desktopProfiles' | 'desktopPnpm' | 'desktopRuntime')[] {
    const names: ('desktopProfiles' | 'desktopPnpm' | 'desktopRuntime')[] = []
    if (this.capability.profileBridgeState !== 'unavailable') names.push('desktopProfiles')
    if (this.capability.pnpmBridgeState !== 'unavailable') names.push('desktopPnpm')
    if (this.capability.runtimePresent) names.push('desktopRuntime')
    return names
  }

  /** Persist a market provider preference. */
  async selectMarket(request: SettingsMarketSelectRequest): Promise<DesktopRestartAcceptance> {
    const previousProvider = this.state.snapshot().market.provider
    const next = this.nextState({ market: { provider: request.provider } })
    await this.state.mutate(next)
    const changed = next.market.provider !== previousProvider
    return Object.freeze({
      accepted: true,
      // A real market change requires the launcher to reinstall; whether the
      // current host can do that is reported separately, so restart is only
      // flagged when the change is persisted and a bridge is ready to apply it.
      restartRequired: changed && marketChangeSupported(this.capability),
    })
  }

  /** Persist the AA preference. */
  async selectAa(request: SettingsAaSelectRequest): Promise<DesktopRestartAcceptance> {
    const previous = this.state.snapshot().aa.enabled
    const next = this.nextState({ aa: { enabled: request.enabled } })
    await this.state.mutate(next)
    const changed = next.aa.enabled !== previous
    return Object.freeze({ accepted: true, restartRequired: changed })
  }

  /** Persist the notifications preference. */
  async updateNotifications(request: SettingsNotificationsUpdateRequest): Promise<{ readonly accepted: true }> {
    const current = this.state.snapshot().notifications
    const events = request.events
    const next = this.nextState({
      notifications: {
        enabled: request.enabled,
        events: {
          sessionEnd: events?.sessionEnd ?? current.events.sessionEnd,
          errors: events?.errors ?? current.events.errors,
          updates: events?.updates ?? current.events.updates,
          progress: events?.progress ?? current.events.progress,
        },
      },
    })
    await this.state.mutate(next)
    return Object.freeze({ accepted: true })
  }

  /** Persist an appearance preference (may require a native host to apply). */
  async updateAppearance(request: SettingsAppearanceUpdateRequest): Promise<{ readonly accepted: true }> {
    const current = this.state.snapshot().appearance
    const next = this.nextState({
      appearance: {
        material: request.material ?? current.material,
        mode: request.mode ?? current.mode,
        nativeCapable: false,
      },
    })
    await this.state.mutate(next)
    return Object.freeze({ accepted: true })
  }

  /**
   * Attempt a Host-专属 action. Returns `ok:false` (never throws, never fakes
   * success) when the current DSH profile has no usable launcher bridge for it.
   */
  async performHostAction(
    kind: SettingsCapabilityToken,
  ): Promise<HostActionResult> {
    switch (kind) {
      case 'host.restart': {
        const restart = this.ports.requestRestart
        if (restart === undefined) return unsupported(this.capability.desktopHost)
        try {
          await restart()
          return { ok: true, acceptance: Object.freeze({ accepted: true }) }
        } catch {
          return { ok: false, code: 'host.failed' }
        }
      }
      case 'host.open-terminal': {
        const openTerminal = this.ports.openTerminal
        if (openTerminal === undefined) return unsupported(this.capability.desktopHost)
        try {
          openTerminal()
          return { ok: true, acceptance: Object.freeze({ accepted: true }) }
        } catch {
          return { ok: false, code: 'host.failed' }
        }
      }
      case 'host.devtools': {
        const toggle = this.ports.toggleDeveloperTools
        if (toggle === undefined) return unsupported(this.capability.desktopHost)
        try {
          toggle()
          return { ok: true, acceptance: Object.freeze({ accepted: true }) }
        } catch {
          return { ok: false, code: 'host.failed' }
        }
      }
      case 'host.diagnostics-export': {
        const exportDiagnostics = this.ports.exportDiagnostics
        if (exportDiagnostics === undefined) return unsupported(this.capability.desktopHost)
        try {
          await exportDiagnostics()
          return { ok: true, acceptance: Object.freeze({ accepted: true }) }
        } catch {
          return { ok: false, code: 'host.failed' }
        }
      }
      case 'host.profile-switch':
        // Profile switching is a dedicated operation with a target name (see
        // `selectProfile`); the token-only perform path stays declined.
        return unsupported(this.capability.desktopHost)
      default:
        return { ok: false, code: 'host.unsupported' }
    }
  }

  private nextState(patch: Partial<Pick<SettingsState, 'market' | 'aa' | 'notifications' | 'appearance'>>): SettingsState {
    const snapshot = this.state.snapshot()
    return {
      version: 1,
      market: {
        provider: patch.market?.provider ?? snapshot.market.provider,
      },
      aa: { enabled: patch.aa?.enabled ?? snapshot.aa.enabled },
      notifications: patch.notifications ?? snapshot.notifications,
      appearance: (patch.appearance ?? snapshot.appearance) as SettingsAppearanceView,
    }
  }
}

function unsupported(desktopHost: boolean): { readonly ok: false; readonly code: 'host.unsupported' | 'host.offline' } {
  return { ok: false, code: desktopHost ? 'host.unsupported' : 'host.offline' }
}

/** Validate a market select body, returning null when malformed. */
export function parseMarketSelect(value: unknown): SettingsMarketSelectRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1) return null
  if (!isMarketProvider(record.provider)) return null
  return { provider: record.provider }
}

/** Validate an AA select body, returning null when malformed. */
export function parseAaSelect(value: unknown): SettingsAaSelectRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1) return null
  if (typeof record.enabled !== 'boolean') return null
  return { enabled: record.enabled }
}

/** Validate a notifications update body, returning null when malformed. */
export function parseNotificationsUpdate(value: unknown): SettingsNotificationsUpdateRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.enabled !== 'boolean') return null
  const events = record.events
  if (events === undefined) return { enabled: record.enabled }
  if (typeof events !== 'object' || events === null || Array.isArray(events)) return null
  const eventRecord = events as Record<string, unknown>
  const known = ['sessionEnd', 'errors', 'updates', 'progress']
  for (const key of Object.keys(eventRecord)) {
    if (!(known as readonly string[]).includes(key)) return null
    if (eventRecord[key] !== undefined && typeof eventRecord[key] !== 'boolean') return null
  }
  const sessionEnd = eventRecord['sessionEnd']
  const errors = eventRecord['errors']
  const updates = eventRecord['updates']
  const progress = eventRecord['progress']
  const eventsPatch = {
    ...(typeof sessionEnd === 'boolean' ? { sessionEnd } : {}),
    ...(typeof errors === 'boolean' ? { errors } : {}),
    ...(typeof updates === 'boolean' ? { updates } : {}),
    ...(typeof progress === 'boolean' ? { progress } : {}),
  }
  return Object.keys(eventsPatch).length > 0
    ? { enabled: record.enabled, events: eventsPatch }
    : { enabled: record.enabled }
}

/** Validate an appearance update body, returning null when malformed. */
export function parseAppearanceUpdate(value: unknown): SettingsAppearanceUpdateRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const material = record.material
  const mode = record.mode
  const materialOk = material === undefined || ['off', 'mica', 'acrylic', 'transparent'].includes(material as string)
  const modeOk = mode === undefined || ['compatibility', 'extended', 'advanced'].includes(mode as string)
  if (!materialOk || !modeOk) return null
  if (material === undefined && mode === undefined) return null
  return {
    ...(material === undefined ? {} : { material: material as SettingsAppearanceView['material'] }),
    ...(mode === undefined ? {} : { mode: mode as SettingsAppearanceView['mode'] }),
  }
}

/** Re-export the default state shape for tests. */
export function initialStateForTest(): SettingsState {
  return defaultState()
}
