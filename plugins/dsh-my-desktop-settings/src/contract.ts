/**
 * Shared wire contract for the dsh-my-desktop-setting Host HTTP API.
 *
 * This is a *standard third-party* DSH plugin that runs inside a DSH profile
 * (target: the `web` profile that dsh-my-desktop launches), same origin as the
 * browser client. It is NOT the Electron launcher, so it never pretends to own
 * launcher-only capabilities. Endpoints live under a distinct `/api/dsh-my-settings`
 * base so they cannot collide with the Desktop shell bridge's `/api/desktop/*`
 * routes.
 *
 * The browser client (`src/client/desktop-settings-api.ts`, authored by another
 * agent) mirrors these exact paths and shapes. Host and client must agree byte
 * for byte; treat this file as the single source of truth for the wire.
 *
 * @module dsh-my-desktop-setting/host-contract
 */

/** Stable base under which every Host endpoint is registered. */
export const API_BASE_PATH = '/api/dsh-my-settings'

/** Provider choices a settings page may persist for the plugin market row. */
export type SettingsMarketProvider = 'disabled' | 'community-market' | 'dsh-market'

/**
 * Stable capability tokens the client uses to decide whether a control is
 * interactive, read-only, or hidden. A Host-专属 action the running DSH profile
 * cannot honor reports `capability: false` with the matching token.
 */
export type SettingsCapabilityToken =
  /** List the running profile / workspace identity (read-only). */
  | 'profile.discover'
  /** Persist a plugin-market provider preference. */
  | 'market.preference'
  /** Persist the AA (Agents-Anywhere) preference. */
  | 'aa.preference'
  /** Persist the notifications preference. */
  | 'notifications.preference'
  /** Persist an appearance preference (material, native frame). */
  | 'appearance.preference'
  /** Switch the active profile via a launcher-owned bridge. */
  | 'host.profile-switch'
  /** Queue an orderly relaunch of the application via a launcher-owned bridge. */
  | 'host.restart'
  /** Open a launcher-owned DSH terminal. */
  | 'host.open-terminal'
  /** Toggle the mounted window's Developer Tools via a launcher-owned bridge. */
  | 'host.devtools'
  /** Export a local diagnostics archive via a launcher-owned bridge. */
  | 'host.diagnostics-export'
  /** Report LAN/browser access and material capabilities of the running host. */
  | 'host.web-and-material'

/** One profile/workspace the plugin can recognize as readable identity. */
export interface SettingsProfileView {
  /** Profile name accepted by the launcher / DSH `--profile`. */
  readonly name: string
  /** Whether the running DSH process identifies this as the current profile. */
  readonly current: boolean
  /** Whether a launcher-backed bridge is present and connected for this profile. */
  readonly bridgeConnected: boolean
  /**
   * Whether an explicit profile directory is known. Directory paths are never
   * serialized to the wire; this is only an availability flag.
   */
  readonly hasDirectory: boolean
  /** Whether this profile exists on disk with a readable manifest. */
  readonly exists?: boolean
  /** Whether this is a launchable Web profile the launcher can switch to. */
  readonly webCapable?: boolean
  /** Whether the launcher allows switching to this profile right now. */
  readonly selectable?: boolean
  /** Whether the launcher allows deleting this profile right now. */
  readonly deletable?: boolean
}

/** Effective notification preference. */
export interface SettingsNotificationsView {
  readonly enabled: boolean
  /** Per-event toggles; the client renders whichever rows the running host supports. */
  readonly events: {
    readonly sessionEnd: boolean
    readonly errors: boolean
    readonly updates: boolean
    readonly progress: boolean
  }
}

/** Appearance preference that only a native shell can make live. */
export interface SettingsAppearanceView {
  /** Preferred native material; `'off'` means "no custom backdrop". */
  readonly material: 'off' | 'mica' | 'acrylic' | 'transparent'
  /** Preferred native presentation mode. */
  readonly mode: 'compatibility' | 'extended' | 'advanced'
  /** Whether the running host can apply material/mode live or at all. */
  readonly nativeCapable: boolean
}

/** One capability slot with a human-usable reason when unsupported. */
export interface SettingsCapabilityView {
  readonly token: SettingsCapabilityToken
  /** Whether the running DSH profile can honor this operation right now. */
  readonly supported: boolean
  /** Stable machine code for a degradation; present only when unsupported. */
  readonly unsupportedCode: 'host.unsupported' | 'host.offline' | null
  /** Renderer-safe reason for the degradation. Never includes native paths. */
  readonly reason: string | null
}

/** Read-only facts describing the recognized profile/workspace. */
export interface SettingsHostIdentityView {
  /** Whether the Electron Desktop launcher is the current host. */
  readonly desktopHost: boolean
  /** Which launcher bridge services this profile exposes to the Host side. */
  readonly bridges: readonly ('desktopProfiles' | 'desktopPnpm' | 'desktopRuntime')[]
  /** Recognized profile(s); at most one is `current`. */
  readonly profiles: readonly SettingsProfileView[]
}

/**
 * Complete renderer-safe projection returned by the read endpoint.
 * Mirrors the DesktopSettingsView responsibilities the browser client needs
 * (profile/market/aa/notifications/appearance + a capability manifest).
 */
export interface DesktopSettingsView {
  /** Name of the currently recognized profile, when one exists. */
  readonly current: string | null
  readonly host: SettingsHostIdentityView
  readonly market: {
    readonly requested: SettingsMarketProvider
    /** Provider this profile is *composed with* at boot, when readable. */
    readonly effective: SettingsMarketProvider
    readonly legacyDefaulted: boolean
  }
  readonly aa: { readonly requested: boolean; readonly effective: boolean }
  readonly notifications: SettingsNotificationsView
  readonly appearance: SettingsAppearanceView
  /** Per-operation capability, so the client can degrade without guessing. */
  readonly capabilities: readonly SettingsCapabilityView[]
}

/** A persisted selection that may require a new generation. */
export interface DesktopRestartAcceptance {
  readonly accepted: true
  readonly restartRequired: boolean
}

/** Stable error body for a declined / failed request. */
export interface SettingsErrorResponse {
  readonly error: string
  /** Stable machine code classifying the failure for client degradation. */
  readonly code: string
  /** Present only for Host-专属 operations the current host cannot run. */
  readonly capability: SettingsCapabilityToken | null
}

/** Body accepted by the market write. */
export interface SettingsMarketSelectRequest {
  readonly provider: SettingsMarketProvider
}

/** Body accepted by the AA write. */
export interface SettingsAaSelectRequest {
  readonly enabled: boolean
}

/** Body accepted by the notifications write. */
export interface SettingsNotificationsUpdateRequest {
  readonly enabled: boolean
  readonly events?: {
    readonly sessionEnd?: boolean
    readonly errors?: boolean
    readonly updates?: boolean
    readonly progress?: boolean
  }
}

/** Body accepted by the appearance write. */
export interface SettingsAppearanceUpdateRequest {
  readonly material?: 'off' | 'mica' | 'acrylic' | 'transparent'
  readonly mode?: 'compatibility' | 'extended' | 'advanced'
}

/** Empty body accepted by a Host-专属 side effect (restart, terminal, …). */
export type SettingsEmptyActionRequest = Readonly<Record<string, never>>

/** Body accepted by a profile create/select/delete operation. */
export interface SettingsProfileRequest {
  readonly name: string
}

/** Endpoint path map shared with the browser client. */
export const settingsPaths = Object.freeze({
  /** GET — full read projection. */
  state: `${API_BASE_PATH}/state`,
  /** POST — persist a plugin-market provider preference. */
  marketSelect: `${API_BASE_PATH}/market/select`,
  /** POST — persist the AA preference. */
  aaSelect: `${API_BASE_PATH}/aa/select`,
  /** POST — persist the notifications preference. */
  notificationsUpdate: `${API_BASE_PATH}/notifications/update`,
  /** POST — persist an appearance preference. */
  appearanceUpdate: `${API_BASE_PATH}/appearance/update`,
  /** POST — Host-专属: create a new Web profile (scaffold + seed, no select). */
  profileCreate: `${API_BASE_PATH}/profile/create`,
  /** POST — Host-专属: switch the active profile through a launcher bridge. */
  profileSwitch: `${API_BASE_PATH}/profile/switch`,
  /** POST — Host-专属: delete an inactive profile through a launcher bridge. */
  profileDelete: `${API_BASE_PATH}/profile/delete`,
  /** POST — Host-专属: request an orderly relaunch through a launcher bridge. */
  restart: `${API_BASE_PATH}/restart`,
  /** POST — Host-专属: open a launcher-owned DSH terminal. */
  terminalOpen: `${API_BASE_PATH}/terminal/open`,
  /** POST — Host-专属: toggle Developer Tools through a launcher bridge. */
  devtoolsToggle: `${API_BASE_PATH}/devtools/toggle`,
  /** POST — Host-专属: export a diagnostics archive through a launcher bridge. */
  diagnosticsExport: `${API_BASE_PATH}/diagnostics/export`,
} as const)
