/**
 * Same-origin browser client for the dsh-my-desktop-setting Host HTTP API.
 *
 * Mirrors the shared wire contract in `../contract.ts` (base `/api/dsh-my-settings`)
 * byte for byte. All DTO types and endpoint paths are imported from that single
 * source of truth so the two sides can never drift. Every read body is re-validated
 * against the contract shape before it reaches React state; every non-2xx response
 * is surfaced as a structured `DesktopSettingsError`.
 *
 * @module dsh-my-desktop-setting/client-api
 */

import {
  settingsPaths,
  type DesktopRestartAcceptance,
  type DesktopSettingsView,
  type SettingsAppearanceUpdateRequest,
  type SettingsCapabilityToken,
  type SettingsCapabilityView,
  type SettingsHostIdentityView,
  type SettingsMarketProvider,
  type SettingsNotificationsUpdateRequest,
  type SettingsNotificationsView,
  type SettingsProfileView,
} from '../contract.ts'

/** Endpoint paths shared with the Host; re-exported for client-side callers. */
export const desktopSettingsPaths = settingsPaths

/** Re-export the contract DTO types the page consumes. */
export type {
  DesktopRestartAcceptance,
  DesktopSettingsView,
  SettingsAppearanceUpdateRequest,
  SettingsCapabilityToken,
  SettingsCapabilityView,
  SettingsMarketProvider,
  SettingsNotificationsUpdateRequest,
  SettingsNotificationsView,
  SettingsProfileView,
} from '../contract.ts'

/** The running profile exposes this much of the plugin-market domain. */

const MARKET_PROVIDERS = new Set<SettingsMarketProvider>(['disabled', 'community-market', 'dsh-market'])
const CAPABILITY_TOKENS = new Set<SettingsCapabilityToken>([
  'profile.discover',
  'market.preference',
  'aa.preference',
  'notifications.preference',
  'appearance.preference',
  'host.profile-switch',
  'host.restart',
  'host.open-terminal',
  'host.devtools',
  'host.diagnostics-export',
  'host.web-and-material',
])
const UNSUPPORTED_CODES = new Set(['host.unsupported', 'host.offline'])
type DesktopBridgeName = 'desktopProfiles' | 'desktopPnpm' | 'desktopRuntime'
const BRIDGES: ReadonlySet<string> = new Set(['desktopProfiles', 'desktopPnpm', 'desktopRuntime'])
const MATERIALS = new Set(['off', 'mica', 'acrylic', 'transparent'])
const MODES = new Set(['compatibility', 'extended', 'advanced'])
const MAX_PROFILES = 256
const MAX_PROFILE_NAME_LENGTH = 255
const MAX_CAPABILITIES = 64
const MAX_REASON_LENGTH = 512

const API_PREFIX = 'dsh-my-desktop-setting'

/** Structured error describing a declined/failed settings request. */
export interface DesktopSettingsError {
  readonly kind: 'http' | 'invalid' | 'capability'
  /** HTTP status when the failure came from the server, else 0. */
  readonly status: number
  /** Stable server machine code, when present. */
  readonly code: string
  /** Capability token the Host refused, when the failure is capability-gated. */
  readonly capability: SettingsCapabilityToken | null
  /** Renderer-safe message. */
  readonly message: string
}

/** Browser operations consumed by the Desktop settings section. */
export interface DesktopSettingsApi {
  /** GET the full renderer-safe projection. */
  read(): Promise<DesktopSettingsView>
  /** POST persist a plugin-market provider preference. */
  selectMarket(provider: SettingsMarketProvider): Promise<DesktopRestartAcceptance>
  /** POST persist the AA preference. */
  selectAa(enabled: boolean): Promise<DesktopRestartAcceptance>
  /** POST persist the notifications preference. */
  updateNotifications(request: SettingsNotificationsUpdateRequest): Promise<void>
  /** POST persist an appearance preference. */
  updateAppearance(request: SettingsAppearanceUpdateRequest): Promise<void>
  /** POST a Host-专属 side effect (restart, terminal, …). */
  performHostAction(token: Exclude<SettingsCapabilityToken, 'profile.discover' | 'market.preference' | 'aa.preference' | 'notifications.preference' | 'appearance.preference' | 'host.profile-switch' | 'host.web-and-material'>): Promise<void>
  /** POST create a new Web profile through the launcher bridge. */
  createProfile(name: string): Promise<void>
  /** POST switch the active profile through the launcher bridge. */
  selectProfile(name: string): Promise<DesktopRestartAcceptance>
  /** POST delete an inactive profile through the launcher bridge. */
  deleteProfile(name: string): Promise<void>
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMarketProvider(value: unknown): value is SettingsMarketProvider {
  return typeof value === 'string' && MARKET_PROVIDERS.has(value as SettingsMarketProvider)
}

function isCapabilityToken(value: unknown): value is SettingsCapabilityToken {
  return typeof value === 'string' && CAPABILITY_TOKENS.has(value as SettingsCapabilityToken)
}

function isMaterial(value: unknown): value is 'off' | 'mica' | 'acrylic' | 'transparent' {
  return typeof value === 'string' && MATERIALS.has(value as 'off' | 'mica' | 'acrylic' | 'transparent')
}

function isMode(value: unknown): value is 'compatibility' | 'extended' | 'advanced' {
  return typeof value === 'string' && MODES.has(value as 'compatibility' | 'extended' | 'advanced')
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function fail(message: string): never {
  throw new Error(`${API_PREFIX}: ${message}`)
}

function parseProfile(value: unknown): SettingsProfileView {
  if (!isObject(value)
    || typeof value.name !== 'string'
    || value.name.length === 0
    || value.name.length > MAX_PROFILE_NAME_LENGTH
    || typeof value.current !== 'boolean'
    || typeof value.bridgeConnected !== 'boolean'
    || typeof value.hasDirectory !== 'boolean') {
    fail('invalid profile in settings response')
  }
  const optional = (key: string): boolean => {
    const v = value[key]
    if (v === undefined) return false
    if (typeof v !== 'boolean') fail('invalid profile flag in settings response')
    return v as boolean
  }
  return Object.freeze({
    name: value.name,
    current: value.current,
    bridgeConnected: value.bridgeConnected,
    hasDirectory: value.hasDirectory,
    ...('exists' in value ? { exists: optional('exists') } : {}),
    ...('webCapable' in value ? { webCapable: optional('webCapable') } : {}),
    ...('selectable' in value ? { selectable: optional('selectable') } : {}),
    ...('deletable' in value ? { deletable: optional('deletable') } : {}),
  })
}

function parseCapability(value: unknown): SettingsCapabilityView {
  if (!isObject(value)
    || !isCapabilityToken(value.token)
    || typeof value.supported !== 'boolean'
    || !hasExactKeys(value, ['token', 'supported', 'unsupportedCode', 'reason'])) {
    fail('invalid capability in settings response')
  }
  const unsupportedCode = value.unsupportedCode
  if (unsupportedCode !== null
    && (typeof unsupportedCode !== 'string' || !UNSUPPORTED_CODES.has(unsupportedCode))) {
    fail('invalid capability code in settings response')
  }
  const reason = value.reason
  if (reason !== null
    && (typeof reason !== 'string' || reason.length === 0 || reason.length > MAX_REASON_LENGTH)) {
    fail('invalid capability reason in settings response')
  }
  return Object.freeze({
    token: value.token,
    supported: value.supported,
    unsupportedCode: unsupportedCode as SettingsCapabilityView['unsupportedCode'],
    reason: reason as SettingsCapabilityView['reason'],
  })
}

function parseHostIdentity(value: unknown): SettingsHostIdentityView {
  if (!isObject(value)
    || typeof value.desktopHost !== 'boolean'
    || !Array.isArray(value.bridges)
    || !Array.isArray(value.profiles)
    || value.profiles.length > MAX_PROFILES
    || !value.bridges.every(bridge => typeof bridge === 'string' && BRIDGES.has(bridge))
    || !hasExactKeys(value, ['desktopHost', 'bridges', 'profiles'])) {
    fail('invalid host identity in settings response')
  }
  const profiles = value.profiles.map(parseProfile)
  if (new Set(profiles.map(profile => profile.name)).size !== profiles.length) {
    fail('duplicate profile in settings response')
  }
  const currentCount = profiles.filter(profile => profile.current).length
  if (currentCount > 1) fail('multiple current profiles in settings response')
  const bridges: readonly DesktopBridgeName[] = (value.bridges as unknown[]).map((bridge) => {
    const name = bridge as DesktopBridgeName
    if (!BRIDGES.has(name)) fail('invalid bridge in settings response')
    return name
  })
  return Object.freeze({
    desktopHost: value.desktopHost,
    bridges: Object.freeze(bridges),
    profiles: Object.freeze(profiles),
  })
}

function parseNotificationsEvents(value: unknown): SettingsNotificationsView['events'] {
  if (!isObject(value)
    || typeof value.sessionEnd !== 'boolean'
    || typeof value.errors !== 'boolean'
    || typeof value.updates !== 'boolean'
    || typeof value.progress !== 'boolean') {
    fail('invalid notification events in settings response')
  }
  return Object.freeze({
    sessionEnd: value.sessionEnd,
    errors: value.errors,
    updates: value.updates,
    progress: value.progress,
  })
}

function parseNotifications(value: unknown): SettingsNotificationsView {
  if (!isObject(value)
    || typeof value.enabled !== 'boolean'
    || !isObject(value.events)) {
    fail('invalid notifications in settings response')
  }
  return Object.freeze({ enabled: value.enabled, events: parseNotificationsEvents(value.events) })
}

function parseAppearance(value: unknown): DesktopSettingsView['appearance'] {
  if (!isObject(value)
    || !isMaterial(value.material)
    || !isMode(value.mode)
    || typeof value.nativeCapable !== 'boolean') {
    fail('invalid appearance in settings response')
  }
  return Object.freeze({
    material: value.material as DesktopSettingsView['appearance']['material'],
    mode: value.mode as DesktopSettingsView['appearance']['mode'],
    nativeCapable: value.nativeCapable,
  })
}

function parseMarket(value: unknown): DesktopSettingsView['market'] {
  if (!isObject(value)
    || !isMarketProvider(value.requested)
    || !isMarketProvider(value.effective)
    || typeof value.legacyDefaulted !== 'boolean') {
    fail('invalid market in settings response')
  }
  return Object.freeze({
    requested: value.requested as SettingsMarketProvider,
    effective: value.effective as SettingsMarketProvider,
    legacyDefaulted: value.legacyDefaulted as boolean,
  })
}

function parseAa(value: unknown): DesktopSettingsView['aa'] {
  if (!isObject(value)
    || typeof value.requested !== 'boolean'
    || typeof value.effective !== 'boolean') {
    fail('invalid AA in settings response')
  }
  return Object.freeze({ requested: value.requested as boolean, effective: value.effective as boolean })
}

function parseCurrent(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PROFILE_NAME_LENGTH) {
    fail('invalid current profile in settings response')
  }
  return value
}

/** Validate the bounded settings projection before it reaches React state. */
export function parseDesktopSettingsView(value: unknown): DesktopSettingsView {
  if (!isObject(value)
    || !Array.isArray(value.capabilities)
    || value.capabilities.length > MAX_CAPABILITIES) {
    fail('invalid Desktop settings response')
  }
  const host = parseHostIdentity(value.host)
  const current = parseCurrent(value.current)
  const market = parseMarket(value.market)
  const aa = parseAa(value.aa)
  const notifications = parseNotifications(value.notifications)
  const appearance = parseAppearance(value.appearance)
  const capabilities = value.capabilities.map(parseCapability)
  if (new Set(capabilities.map(capability => capability.token)).size !== capabilities.length) {
    fail('duplicate capability in settings response')
  }
  const parsed: DesktopSettingsView = Object.freeze({
    current,
    host,
    market,
    aa,
    notifications,
    appearance,
    capabilities: Object.freeze(capabilities),
  })
  if (current !== null && !host.profiles.some(profile => profile.name === current)) {
    fail('current profile is not listed in the host identity')
  }
  return parsed
}

/** Validate restart acknowledgement returned before the Host generation exits. */
export function parseDesktopRestartAcceptance(value: unknown): DesktopRestartAcceptance {
  if (!isObject(value) || value.accepted !== true || typeof value.restartRequired !== 'boolean') {
    fail('invalid restart response')
  }
  return Object.freeze({ accepted: true, restartRequired: value.restartRequired })
}

/** Validate the exact acknowledgement returned by a plain side effect. */
export function parseDesktopActionAcceptance(value: unknown): void {
  if (!isObject(value) || Object.keys(value).length !== 1 || value.accepted !== true) {
    fail('invalid action response')
  }
}

function parseError(value: unknown): DesktopSettingsError {
  if (!isObject(value)
    || typeof value.error !== 'string'
    || typeof value.code !== 'string') {
    return { kind: 'invalid', status: 0, code: 'invalid.error', capability: null, message: 'server returned an unparseable error' }
  }
  const rawCapability = value.capability
  const capability = rawCapability === null ? null
    : typeof rawCapability === 'string' && isCapabilityToken(rawCapability)
      ? rawCapability as SettingsCapabilityToken
      : undefined
  if (capability === undefined) {
    return { kind: 'invalid', status: 0, code: 'invalid.error', capability: null, message: 'server returned an unparseable error' }
  }
  return {
    kind: capability !== null ? 'capability' : 'http',
    status: 0,
    code: value.code,
    capability,
    message: value.error,
  }
}

async function readErrorResponse(response: Response): Promise<DesktopSettingsError> {
  let body: unknown
  try {
    body = await response.json() as unknown
  } catch {
    body = null
  }
  const parsed = body !== null ? parseError(body) : null
  if (parsed !== null) {
    return { ...parsed, status: response.status }
  }
  return {
    kind: 'http',
    status: response.status,
    code: `http.${String(response.status)}`,
    capability: null,
    message: `settings request failed (${String(response.status)})`,
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  try {
    return await response.json() as unknown
  } catch {
    throw Object.freeze({
      kind: 'invalid' as const,
      status: response.status,
      code: 'bad.json',
      capability: null as SettingsCapabilityToken | null,
      message: 'settings response was not JSON',
    }) satisfies DesktopSettingsError
  }
}

function post(fetcher: FetchLike, path: string, body: object): Promise<Response> {
  return fetcher(path, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** Construct the default same-origin API, with a fetch seam for focused tests. */
export function createDesktopSettingsApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopSettingsApi {
  return Object.freeze({
    async read() {
      const response = await fetcher(settingsPaths.state, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      return parseDesktopSettingsView(await readJsonResponse(response))
    },
    async selectMarket(provider: SettingsMarketProvider) {
      return parseDesktopRestartAcceptance(await readJsonResponse(await post(fetcher, settingsPaths.marketSelect, { provider })))
    },
    async selectAa(enabled: boolean) {
      return parseDesktopRestartAcceptance(await readJsonResponse(await post(fetcher, settingsPaths.aaSelect, { enabled })))
    },
    async updateNotifications(request: SettingsNotificationsUpdateRequest) {
      parseDesktopActionAcceptance(await readJsonResponse(await post(fetcher, settingsPaths.notificationsUpdate, request)))
    },
    async updateAppearance(request: SettingsAppearanceUpdateRequest) {
      parseDesktopActionAcceptance(await readJsonResponse(await post(fetcher, settingsPaths.appearanceUpdate, request)))
    },
    async performHostAction(token: Parameters<DesktopSettingsApi['performHostAction']>[0]) {
      const path = hostActionPath(token)
      parseDesktopActionAcceptance(await readJsonResponse(await post(fetcher, path, {})))
    },
    async createProfile(name: string) {
      parseDesktopActionAcceptance(await readJsonResponse(await post(fetcher, settingsPaths.profileCreate, { name })))
    },
    async selectProfile(name: string) {
      return parseDesktopRestartAcceptance(await readJsonResponse(await post(fetcher, settingsPaths.profileSwitch, { name })))
    },
    async deleteProfile(name: string) {
      parseDesktopActionAcceptance(await readJsonResponse(await post(fetcher, settingsPaths.profileDelete, { name })))
    },
  })
}

function hostActionPath(token: Exclude<SettingsCapabilityToken, 'profile.discover' | 'market.preference' | 'aa.preference' | 'notifications.preference' | 'appearance.preference' | 'host.profile-switch' | 'host.web-and-material'>): string {
  switch (token) {
    case 'host.restart': return settingsPaths.restart
    case 'host.open-terminal': return settingsPaths.terminalOpen
    case 'host.devtools': return settingsPaths.devtoolsToggle
    case 'host.diagnostics-export': return settingsPaths.diagnosticsExport
  }
}
