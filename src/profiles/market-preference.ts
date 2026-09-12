/**
 * Read the desktop settings plugin's plugin-market preference, from the launcher.
 *
 * WHY THIS EXISTS
 * ---------------
 * The "Plugin market" row used to be a preference with no effect: the settings
 * plugin persisted the choice in its own state file, and nothing else ever read
 * it, so the market package shipped inside the installer was seeded into every
 * profile regardless. Choosing "do not enable a plugin market" therefore did not
 * stop the market from loading — it only recorded an intention.
 *
 * This module closes that gap by making the choice load-bearing: the launcher
 * reads the preference before boot and decides whether the market package is
 * allowed into the profile's `dsh.profile.bundles` list.
 *
 * The state file is the SAME file the settings plugin writes
 * (`<profile>/.dsh-my-settings/state.json`, see the plugin's `state-store.ts`);
 * the two sides agree on the on-disk document shape, so no new channel or IPC is
 * needed. The reader is deliberately total and best-effort:
 *
 *  - a missing file, unreadable file, malformed JSON, wrong schema version, or an
 *    unrecognised provider all resolve to the SAFE default (`disabled`) — the
 *    market stays out rather than being loaded because its preference was unclear;
 *  - an explicit `dsh-market` is the only value that enables the market.
 *
 * @module dsh-my-desktop/market-preference
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The plugin's state directory name inside a profile. */
export const SETTINGS_STATE_DIR_NAME = '.dsh-my-settings'

/** The plugin's state file name inside that directory. */
export const SETTINGS_STATE_FILE_NAME = 'state.json'

/** Schema version the reader understands; anything else is not trusted. */
const SUPPORTED_STATE_VERSION = 1

/** The only provider value that loads a market. */
export const MARKET_PROVIDER_DSH = 'dsh-market' as const

/** Provider the launcher assumes when no trustworthy preference is readable. */
export const MARKET_PROVIDER_DISABLED = 'disabled' as const

/** The market package the `dsh-market` provider corresponds to. */
export const DSH_MARKET_PACKAGE = 'dshmarket'

export type MarketProvider = typeof MARKET_PROVIDER_DISABLED | typeof MARKET_PROVIDER_DSH

/**
 * Absolute path of the settings plugin's state file for a profile.
 *
 * Kept in one place so the reader below and any future writer cannot drift on
 * the directory layout.
 */
export function settingsStatePath(profileDir: string): string {
  return join(profileDir, SETTINGS_STATE_DIR_NAME, SETTINGS_STATE_FILE_NAME)
}

/**
 * Read the persisted market provider for a profile.
 *
 * Returns the safe default (`disabled`) whenever the preference cannot be read
 * with confidence. Callers therefore never need to distinguish "absent" from
 * "malformed" — both mean "do not load a market".
 */
export function readMarketProvider(profileDir: string): MarketProvider {
  const filePath = settingsStatePath(profileDir)
  if (!existsSync(filePath)) return MARKET_PROVIDER_DISABLED
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return MARKET_PROVIDER_DISABLED
    const record = parsed as Record<string, unknown>
    // An unrecognised version means a document this build cannot interpret.
    if (record['version'] !== SUPPORTED_STATE_VERSION) return MARKET_PROVIDER_DISABLED
    const market = record['market']
    if (typeof market !== 'object' || market === null || Array.isArray(market)) return MARKET_PROVIDER_DISABLED
    return (market as Record<string, unknown>)['provider'] === MARKET_PROVIDER_DSH
      ? MARKET_PROVIDER_DSH
      : MARKET_PROVIDER_DISABLED
  } catch {
    // A corrupt or unreadable file must never break the launch, and must not be
    // optimistically read as "market enabled".
    return MARKET_PROVIDER_DISABLED
  }
}

/**
 * Whether the market package should be present in this profile's bundle list.
 *
 * `disabled` means the package is actively kept out — not merely left
 * un-installed — so a profile that previously had the market enabled stops
 * loading it as soon as the user turns the market off.
 */
export function isMarketEnabled(profileDir: string): boolean {
  return readMarketProvider(profileDir) === MARKET_PROVIDER_DSH
}

/**
 * Filter a seeded plugin catalog down to what this profile's market choice allows.
 *
 * Only {@link DSH_MARKET_PACKAGE} is gated: every other bundled plugin is
 * unrelated to the market switch and passes through untouched. Keeping the
 * filter keyed on the package name (rather than on a provider table) means a
 * catalog that no longer ships a market simply passes through unchanged.
 *
 * The generic preserves the caller's plugin type (`BundledPlugin` and friends)
 * through the filter, so a gated catalog is still a `BundledPlugin[]`.
 */
export function applyMarketPreference<T extends { packageName: string }>(
  catalog: readonly T[],
  profileDir: string,
): readonly T[] {
  if (isMarketEnabled(profileDir)) return catalog
  return catalog.filter(plugin => plugin.packageName !== DSH_MARKET_PACKAGE)
}
