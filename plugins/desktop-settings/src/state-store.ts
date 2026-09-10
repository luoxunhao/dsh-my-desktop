/**
 * Own JSON state persistence for dsh-my-desktop-setting.
 *
 * The plugin persists self-consistent preferences (market provider, AA, the
 * notifications toggles, appearance preference) in its own versioned JSON state
 * file under an explicit, environment-resolved directory. It deliberately does
 * NOT depend on `process.cwd()`, and it does not require a registered
 * `ctx.settings` namespace (which would pull in undeclared `@deepseek-ai/dsh-settings`
 * + `@deepseek-ai/schemastery` runtime imports). All runtime imports here are
 * `node:` builtins.
 *
 * @module dsh-my-desktop-setting/state-store
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  SettingsAppearanceView,
  SettingsMarketProvider,
  SettingsNotificationsView,
} from './contract.js'

/** Stable schema version; bump only with an explicit migration below. */
export const STATE_VERSION = 1

/** Default file name inside the state directory. */
export const STATE_FILE_NAME = 'state.json'

const MAX_STATE_BYTES = 64 * 1024

/** Shape of the persisted document (version 1). */
export interface SettingsStateV1 {
  readonly version: 1
  readonly market: { readonly provider: SettingsMarketProvider }
  readonly aa: { readonly enabled: boolean }
  readonly notifications: SettingsNotificationsView
  readonly appearance: SettingsAppearanceView
}

/** Environment facts used to resolve the state directory. */
export interface StatePathEnvironment {
  /** Running profile directory (set by the dsh-my-desktop launcher). */
  readonly DSH_PROFILE_DIR?: string
  /** Active DSH home directory (fallback source). */
  readonly DSH_HOME?: string
  /** Explicit profile name (fallback source). */
  readonly DSH_PROFILE_NAME?: string
  /** Test-only explicit override of the state directory. */
  readonly DSH_MY_SETTINGS_STATE_DIR?: string
}

/** Parsed, schema-validated state. */
export type SettingsState = SettingsStateV1

/**
 * Resolve the state directory and file path for the current process. The path
 * is always explicit and absolute; when no authoritative directory can be found
 * the store reports itself as unavailable (reads return defaults, writes are a
 * no-op error) rather than falling back to an unspecified location.
 */
export function resolveStateFilePaths(env: StatePathEnvironment = process.env): {
  readonly directory: string | null
  readonly filePath: string | null
} {
  const override = env.DSH_MY_SETTINGS_STATE_DIR
  if (override !== undefined && override.length > 0) {
    const dir = resolve(override)
    return { directory: dir, filePath: join(dir, STATE_FILE_NAME) }
  }
  const profileDir = env.DSH_PROFILE_DIR
  if (profileDir !== undefined && profileDir.length > 0 && isAbsolute(profileDir)) {
    const dir = join(profileDir, '.dsh-my-settings')
    return { directory: dir, filePath: join(dir, STATE_FILE_NAME) }
  }
  const home = env.DSH_HOME
  const profileName = env.DSH_PROFILE_NAME
  if (home !== undefined && home.length > 0 && isAbsolute(home)
    && profileName !== undefined && profileName.length > 0) {
    const dir = join(home, 'profiles', profileName, '.dsh-my-settings')
    return { directory: dir, filePath: join(dir, STATE_FILE_NAME) }
  }
  return { directory: null, filePath: null }
}

const MARKET_PROVIDERS: readonly string[] = ['disabled', 'community-market', 'dsh-market']
const MATERIALS: readonly string[] = ['off', 'mica', 'acrylic', 'transparent']
const MODES: readonly string[] = ['compatibility', 'extended', 'advanced']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMarketProvider(value: unknown): value is SettingsMarketProvider {
  return typeof value === 'string' && (MARKET_PROVIDERS as readonly string[]).includes(value)
}

function isMaterial(value: unknown): value is 'off' | 'mica' | 'acrylic' | 'transparent' {
  return typeof value === 'string' && (MATERIALS as readonly string[]).includes(value)
}

function isMode(value: unknown): value is 'compatibility' | 'extended' | 'advanced' {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

function isBool(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function defaultAppearance(): SettingsAppearanceView {
  return Object.freeze({ material: 'off', mode: 'compatibility', nativeCapable: false })
}

function defaultNotifications(): SettingsNotificationsView {
  return Object.freeze({
    enabled: true,
    events: Object.freeze({ sessionEnd: true, errors: true, updates: true, progress: true }),
  })
}

/** The store's defaults, used when the file is absent or malformed. */
export function defaultState(): SettingsState {
  return {
    version: STATE_VERSION,
    market: { provider: 'disabled' },
    aa: { enabled: false },
    notifications: defaultNotifications(),
    appearance: defaultAppearance(),
  }
}

/** Validate a parsed document or throw. */
function parseState(value: unknown): SettingsState {
  if (!isRecord(value) || value.version !== STATE_VERSION) {
    throw new Error(`dsh-my-desktop-setting: unsupported state (expected version ${String(STATE_VERSION)})`)
  }
  const market = value.market
  const aa = value.aa
  const notifications = value.notifications
  const appearance = value.appearance
  if (!isRecord(market) || !isMarketProvider(market.provider)) {
    throw new Error('dsh-my-desktop-setting: invalid market state')
  }
  if (!isRecord(aa) || !isBool(aa.enabled)) {
    throw new Error('dsh-my-desktop-setting: invalid AA state')
  }
  if (!isRecord(notifications) || !isBool(notifications.enabled)
    || !isRecord(notifications.events)
    || !isBool(notifications.events.sessionEnd)
    || !isBool(notifications.events.errors)
    || !isBool(notifications.events.updates)
    || !isBool(notifications.events.progress)) {
    throw new Error('dsh-my-desktop-setting: invalid notifications state')
  }
  if (!isRecord(appearance) || !isMaterial(appearance.material) || !isMode(appearance.mode)) {
    throw new Error('dsh-my-desktop-setting: invalid appearance state')
  }
  return {
    version: STATE_VERSION,
    market: { provider: market.provider },
    aa: { enabled: aa.enabled },
    notifications: {
      enabled: notifications.enabled,
      events: {
        sessionEnd: notifications.events.sessionEnd,
        errors: notifications.events.errors,
        updates: notifications.events.updates,
        progress: notifications.events.progress,
      },
    },
    appearance: {
      material: appearance.material,
      mode: appearance.mode,
      nativeCapable: false,
    },
  }
}

/**
 * In-memory, dependency-free persistence for the plugin's preferences. Reads are
 * best-effort and total (malformed/absent state falls back to defaults); writes
 * are serialized and atomic (temp file + rename) with a size and shape guard.
 */
export class SettingsStateStore {
  private readonly directory: string | null
  private readonly filePath: string | null
  private current: SettingsState
  private readonly hadStoredFile: boolean
  private writeTail: Promise<void> = Promise.resolve()

  /**
   * @param directory - explicit absolute state directory, or null when unavailable.
   * @param filePath - explicit absolute state file, or null when unavailable.
   */
  constructor(
    directory: string | null,
    filePath: string | null,
  ) {
    this.directory = directory
    this.filePath = filePath
    this.hadStoredFile = filePath !== null && existsSync(filePath)
    this.current = this.loadInitial(filePath)
  }

  /** Whether a durable write destination is available. */
  get available(): boolean {
    return this.directory !== null && this.filePath !== null
  }

  /** Whether a real, previously stored state document was read at startup. */
  get hasPersistedState(): boolean {
    return this.hadStoredFile
  }

  private loadInitial(filePath: string | null): SettingsState {
    if (filePath === null) return defaultState()
    try {
      if (!existsSync(filePath)) return defaultState()
      const stat = readFileSync(filePath)
      if (stat.byteLength > MAX_STATE_BYTES) return defaultState()
      return parseState(JSON.parse(stat.toString('utf8')) as unknown)
    } catch {
      // A corrupt or oversized file must never crash the read path.
      return defaultState()
    }
  }

  /** Current resolved snapshot (caller must not mutate the result). */
  snapshot(): SettingsState {
    return this.current
  }

  /**
   * Apply a pure reducer producing the next state, then persist atomically.
   * Writes to this instance are serialized; rejections are returned, not thrown
   * out-of-band.
   */
  async mutate(next: SettingsState): Promise<void> {
    const filePath = this.filePath
    const directory = this.directory
    if (filePath === null || directory === null) {
      throw new Error('dsh-my-desktop-setting: no explicit state directory (write unavailable)')
    }
    const write = async (): Promise<void> => {
      await this.persist(directory, filePath, next)
      this.current = next
    }
    this.writeTail = this.writeTail.then(write, write)
    return this.writeTail
  }

  private persist(directory: string, filePath: string, state: SettingsState): void {
    mkdirSync(directory, { recursive: true })
    const rendered = `${JSON.stringify(state)}\n`
    if (Buffer.byteLength(rendered, 'utf8') > MAX_STATE_BYTES) {
      throw new Error('dsh-my-desktop-setting: state exceeds the size limit')
    }
    const tempPath = join(directory, `.${STATE_FILE_NAME}.${process.pid}.tmp`)
    try {
      writeFileSync(tempPath, rendered, 'utf8')
      renameSync(tempPath, filePath)
    } finally {
      try {
        unlinkSync(tempPath)
      } catch {
        // Best-effort temp cleanup; rename may already have removed it.
      }
    }
  }
}
