/**
 * Managed-profile registry for DSH My Desktop.
 *
 * The launcher historically launched a single hard-coded "web" profile. This
 * module introduces a small, explicit profile model so a settings page can
 * enumerate, create, select and delete web profiles like dsh-desktop does:
 *
 * - profiles live under `<home>/profiles/<name>` with a real `package.json`
 *   manifest (same layout the official runtime seed already expects);
 * - the **active** profile is persisted (not hard-coded "web") in a tiny
 *   registry file under the launcher user-data dir, so a relaunch continues on
 *   the last selected profile;
 * - profile names are validated against the same constraints dsh-desktop uses
 *   (no path separators, no reserved names, no control/reserved chars), so a
 *   name can cross the state file safely.
 *
 * @module dsh-my-desktop/profile-registry
 */

import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, renameSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { writeTextFileAtomicSync } from '../infra/atomic-file.js'
import { OFFICIAL_PROFILE_BUNDLES } from '../runtime/bundled-plugins.js'
import { pnpmWorkspaceYaml } from '../runtime/bundled-plugins.js'

/** Default profile, kept for backward compatibility with existing installs. */
export const DEFAULT_PROFILE_NAME = 'web'

/** Bundle names that mark a directory as the official Web profile. */
export const WEB_BUNDLE_NAME = '@deepseek-ai/dsh-web-app'
export const BASE_BUNDLE_NAME = '@deepseek-ai/dsh-base'

const STATE_VERSION = 1
const MAX_PROFILE_NAME_BYTES = 64

/** A recognized profile and its renderer-safe discovery facts. */
export interface ManagedProfile {
  readonly name: string
  readonly dir: string
  readonly exists: boolean
  /** Has a readable manifest whose bundles form a launchable Web profile. */
  readonly webCapable: boolean
  readonly selectable: boolean
  readonly deletable: boolean
  /** When the manifest is broken or unusable, a renderer-safe reason. */
  readonly problem: string | null
}

/** A summary of the active profile (persisted selection). */
export interface ProfileRegistryState {
  readonly version: number
  /** The profile name to launch on the next startup. */
  readonly active: string
}

/** Filesystem-root facts needed to resolve profile directories. */
export interface ProfileRoots {
  /** `.dsh` home; `<home>/profiles/<name>` holds each profile. */
  readonly home: string
  /** Directory where the launcher writes its own registry state. */
  readonly stateDir: string
}

/** Profile name that must not be discovered (the launcher's internal dirs). */
const HIDDEN_OR_RESERVED = new Set(['node_modules', '.pnpm-store'])

/**
 * Reject profile names that cannot safely cross the persisted state boundary
 * or name a directory on Windows.
 */
function profileNameUnsafe(name: string): string | undefined {
  if (typeof name !== 'string') return 'profile name must be a string'
  if (name.length === 0) return 'profile name must not be empty'
  if (name.includes('/') || name.includes('\\')) return 'profile name must not contain path separators'
  if (name === '.' || name === '..') return 'profile name must not be "." or ".."'
  if (name === 'node_modules') return 'profile name must not be "node_modules"'
  if (Buffer.byteLength(name, 'utf8') > MAX_PROFILE_NAME_BYTES) return 'profile name is too long'
  if (/[\0-\x1f\x7f-\x9f]/.test(name)) return 'profile name contains control characters'
  if (/[<>:"|?*]/.test(name)) return 'profile name contains reserved filename characters'
  if (/[. ]$/.test(name)) return 'profile name must not end with "." or a space'
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name)) return 'profile name is a reserved device name'
  return undefined
}

/** Validate a profile name or throw a renderer-safe error. */
export function assertProfileName(name: string): void {
  const reason = profileNameUnsafe(name)
  if (reason !== undefined) throw new Error(`invalid profile name ${JSON.stringify(name)}: ${reason}`)
}

/** Whether a name is safe to use as a profile directory / selection value. */
export function isSafeProfileName(name: unknown): name is string {
  return typeof name === 'string' && profileNameUnsafe(name) === undefined
}

/** Resolve `<home>/profiles/<name>` (name pre-validated by callers). */
export function profileDirFor(home: string, name: string): string {
  return join(home, 'profiles', name)
}

/** Resolve `<stateDir>/profile-registry.json` used to remember the active profile. */
function registryPath(stateDir: string): string {
  return join(stateDir, 'profile-registry.json')
}

function readRegistry(roots: ProfileRoots): ProfileRegistryState {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(roots.stateDir), 'utf8')) as Partial<ProfileRegistryState>
    const active = isSafeProfileName(parsed.active) ? parsed.active : DEFAULT_PROFILE_NAME
    return { version: STATE_VERSION, active }
  } catch {
    return { version: STATE_VERSION, active: DEFAULT_PROFILE_NAME }
  }
}

/** Read the active profile name (defaults to the legacy "web"). */
export function readActiveProfile(roots: ProfileRoots): string {
  return readRegistry(roots).active
}

/** Persist the active profile name (throwing on unsafe input). */
export function writeActiveProfile(roots: ProfileRoots, name: string): void {
  assertProfileName(name)
  mkdirSync(roots.stateDir, { recursive: true })
  writeTextFileAtomicSync(registryPath(roots.stateDir), `${JSON.stringify({ version: STATE_VERSION, active: name }, undefined, 2)}\n`)
}

/** Whether a discovered directory basename is a candidate real profile dir. */
function isCandidateProfileName(basename: string): boolean {
  if (basename === '' || basename.startsWith('.') || HIDDEN_OR_RESERVED.has(basename)) return false
  return isSafeProfileName(basename)
}

/** Read a profile manifest's bundle list, tolerating a missing/broken manifest. */
function readProfileManifest(dir: string): { bundles: readonly string[]; name?: string; problem?: string } {
  const manifestPath = join(dir, 'package.json')
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: unknown
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles)
      ? manifest.dsh.profile.bundles.filter((value): value is string => typeof value === 'string')
      : []
    return {
      bundles,
      ...(typeof manifest.name === 'string' ? { name: manifest.name } : {}),
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { bundles: [], problem: `could not read manifest: ${message}` }
  }
}

/** Describe one on-disk profile directory. */
function describeProfile(home: string, name: string, active: string): ManagedProfile {
  const dir = profileDirFor(home, name)
  let exists = false
  let webCapable = false
  let problem: string | null = null
  try {
    const stat = lstatSync(dir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      problem = 'profile path is not a real directory'
    } else {
      exists = true
      const manifest = readProfileManifest(dir)
      if (manifest.problem !== undefined) {
        problem = manifest.problem
      } else {
        const baseIndex = manifest.bundles.indexOf(BASE_BUNDLE_NAME)
        const webIndex = manifest.bundles.indexOf(WEB_BUNDLE_NAME)
        webCapable = baseIndex !== -1 && webIndex !== -1 && webIndex > baseIndex
        if (!webCapable) problem = 'profile is not a launchable Web profile'
      }
    }
  } catch (cause) {
    problem = cause instanceof Error ? cause.message : String(cause)
  }
  return Object.freeze({
    name,
    dir,
    exists,
    webCapable,
    selectable: exists && webCapable && problem === null,
    deletable: exists && name !== active,
    problem: exists && problem !== null ? problem : null,
  })
}

/**
 * List the managed profiles under `<home>/profiles`, prefixed by the default
 * "web" so a fresh install always shows at least one selectable profile.
 */
export function listProfiles(roots: ProfileRoots, active = readActiveProfile(roots)): readonly ManagedProfile[] {
  const profilesDir = join(roots.home, 'profiles')
  const names = new Set<string>()
  try {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (isCandidateProfileName(entry.name)) names.add(entry.name)
    }
  } catch {
    // Missing profiles root = nothing discovered yet.
  }
  // Always include the default so the list is never empty.
  names.add(DEFAULT_PROFILE_NAME)
  const ordered = [...names].sort((a, b) => (a === DEFAULT_PROFILE_NAME ? -1 : b === DEFAULT_PROFILE_NAME ? 1 : a.localeCompare(b)))
  return ordered.map((name) => describeProfile(roots.home, name, active))
}

/** Create a new Web profile directory (scaffold only; no seed/selection yet). */
export function createProfileDirectory(roots: ProfileRoots, name: string): ManagedProfile {
  assertProfileName(name)
  const target = profileDirFor(roots.home, name)
  if (existsSync(target)) throw new Error(`profile ${JSON.stringify(name)} already exists`)
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...OFFICIAL_PROFILE_BUNDLES] } },
  }, undefined, 2)}\n`)
  writeFileSync(join(target, 'cordis.patch.yml'), '# Your patch layer for this dsh profile.\n[]\n', 'utf8')
  writeFileSync(join(target, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(false), 'utf8')
  return describeProfile(roots.home, name, readActiveProfile(roots))
}

/** Remove a non-active profile from disk (fails closed when it is active). */
export function deleteProfileDirectory(roots: ProfileRoots, name: string, active = readActiveProfile(roots)): void {
  assertProfileName(name)
  if (name === active) throw new Error(`cannot delete the active profile ${JSON.stringify(name)}`)
  const target = profileDirFor(roots.home, name)
  if (!existsSync(target)) return
  const stat = lstatSync(target)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('profile path is not a removable directory')
  // Move to a hidden sibling trash name first, then remove, so a partially
  // deleted profile is never discovered as a real profile.
  const trash = join(dirname(target), `.${basename(target)}.trash-${process.pid}`)
  rmSync(trash, { recursive: true, force: true })
  renameSync(target, trash)
  try {
    rmSync(trash, { recursive: true, force: true })
  } catch (cause) {
    console.error(`删除 profile ${name} 的回收目录失败。`, cause)
  }
}

/** Resolve the launch roots for the profile registry from env/userData. */
export function resolveProfileRoots(options: { home?: string; stateDir?: string }): ProfileRoots {
  const home = options.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const stateDir = options.stateDir ?? process.env.DSH_PROFILE_SELECTION_DIR ?? join(homedir(), '.dsh', 'launcher')
  return { home, stateDir }
}
