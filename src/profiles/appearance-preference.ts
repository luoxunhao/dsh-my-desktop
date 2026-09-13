/**
 * Read the desktop settings plugin's window-appearance preference, from the launcher.
 *
 * WHY THIS EXISTS
 * ---------------
 * "Desktop appearance and behavior" used to be a preference with no effect: the
 * settings plugin persisted the chosen window material in its own state file, and
 * nothing in the launcher ever read it, so picking Mica changed nothing about the
 * window. Choosing "no window material" changed nothing either. The switch only
 * recorded an intention.
 *
 * This module closes that gap by making the choice load-bearing: the launcher
 * reads it while starting up and feeds it to `window-material.ts`, which turns it
 * into the `BrowserWindow` options that actually paint the material.
 *
 * The state file is the SAME document the settings plugin writes
 * (`<profile>/.dsh-my-settings/state.json`, see the plugin's `state-store.ts`).
 * `market-preference.ts` is the single authority for that file's location and its
 * schema version, and we reuse both rather than restating them, so the two
 * readers cannot drift apart. The reader is deliberately total and best-effort:
 *
 *  - a missing file, unreadable file, malformed JSON, wrong schema version, or an
 *    unrecognised material all resolve to the SAFE default (`off`) — the stock
 *    window — rather than to a guess;
 *  - `off` means "leave the window exactly as it is", not "force a plain frame",
 *    so a profile that has never opened this setting is untouched.
 *
 * PRESENTATION MODE IS DELIBERATELY NOT READ HERE
 * ----------------------------------------------
 * The same document also carries `appearance.mode`
 * (`compatibility` / `extended` / `advanced`). The shell implements exactly one
 * layout, so reading it would create a second preference with no effect — the
 * very defect this module exists to remove. Wiring it up needs the alternative
 * layouts to exist first; until then the launcher stays silent about it rather
 * than pretending.
 *
 * @module dsh-my-desktop/appearance-preference
 */

import { existsSync, readFileSync } from 'node:fs'

import { settingsStatePath, SUPPORTED_STATE_VERSION } from './market-preference.js'

/**
 * Window materials the launcher understands.
 *
 * This mirrors the settings plugin's contract (`SettingsAppearanceView.material`)
 * so a value the UI can store is never silently unknown here. Note that
 * recognising a value is not the same as being able to apply it: see
 * `resolveWindowMaterialOptions` for which ones actually paint.
 */
export const APPEARANCE_MATERIALS = ['off', 'mica', 'acrylic', 'transparent'] as const

/** A window material as persisted by the settings plugin. */
export type AppearanceMaterial = (typeof APPEARANCE_MATERIALS)[number]

/**
 * Material assumed when nothing trustworthy is persisted.
 *
 * `off` is the safe answer in both directions: it is the plugin's own default,
 * and it is the only value that leaves the window options byte-identical to a
 * build without this feature.
 */
export const DEFAULT_APPEARANCE_MATERIAL: AppearanceMaterial = 'off'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAppearanceMaterial(value: unknown): value is AppearanceMaterial {
  return typeof value === 'string' && (APPEARANCE_MATERIALS as readonly string[]).includes(value)
}

/**
 * Read the persisted window material for a profile.
 *
 * Returns {@link DEFAULT_APPEARANCE_MATERIAL} whenever the preference cannot be
 * read with confidence, so callers never need to distinguish "absent" from
 * "malformed" — both mean "do not touch the window".
 */
export function readAppearanceMaterial(profileDir: string): AppearanceMaterial {
  const filePath = settingsStatePath(profileDir)
  if (!existsSync(filePath)) return DEFAULT_APPEARANCE_MATERIAL
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (!isRecord(parsed)) return DEFAULT_APPEARANCE_MATERIAL
    // An unrecognised version means a document this build cannot interpret.
    if (parsed['version'] !== SUPPORTED_STATE_VERSION) return DEFAULT_APPEARANCE_MATERIAL
    const appearance = parsed['appearance']
    if (!isRecord(appearance)) return DEFAULT_APPEARANCE_MATERIAL
    const material = appearance['material']
    // An unknown material is treated as absent rather than passed through: the
    // window constructor would reject it.
    return isAppearanceMaterial(material) ? material : DEFAULT_APPEARANCE_MATERIAL
  } catch {
    // A corrupt or unreadable file must never break the launch, and must not be
    // optimistically read as "a glass material was requested".
    return DEFAULT_APPEARANCE_MATERIAL
  }
}
