/**
 * Disposable, launcher-owned DSH environment used by Safe Mode.
 *
 * MODELLED ON dsh-desktop's `safe-mode.ts` — same function names and the same
 * safety properties, so the two stay comparable.
 *
 * WHAT THIS BUYS
 * --------------
 * When a profile is so broken that the app cannot start, the user needs to get in
 * and fix it. Safe Mode boots against a THROWAWAY environment instead: its own
 * `DSH_HOME`, its own Desktop state. It never reads or writes the real `~/.dsh`.
 * Once the user is done, the whole tree is deleted.
 *
 * THE TWO SAFETY BOUNDARIES (see the tests that pin them)
 * -------------------------------------------------------
 * 1. A **symlinked root is never adopted.** If the root were a link to `~/.dsh`,
 *    adopting it would make the next cleanup delete the user's real data.
 * 2. **Cleanup unlinks symlinks instead of recursing through them**, for exactly
 *    the same reason: the disposable tree may contain links pointing outside it.
 *
 * Both are hostile-input cases rather than normal operation, which is why they get
 * dedicated tests instead of relying on review.
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { createProfileDirectory, profileDirFor, resolveProfileRoots, writeActiveProfile } from '../profiles/profiles.js'

const BIN_NAME = 'DSH My Desktop'
const SAFE_MODE_DIRECTORY = 'safe-mode'
const SAFE_MODE_MARKER = 'environment.json'
const SAFE_MODE_VERSION = 1
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const MAX_MARKER_BYTES = 4 * 1024
/** Windows holds locks briefly after a process exits; these are worth retrying. */
const CLEANUP_RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'])

/** Visible profile identity used throughout the temporary DSH environment. */
export const DESKTOP_SAFE_MODE_PROFILE_NAME = 'desktop-safe-mode'

export interface DesktopSafeModePaths {
  /** Root removed during Safe Mode shutdown and retried on the next normal launch. */
  readonly rootDir: string
  /** Isolated Harness home; Safe Mode never reads the normal `~/.dsh`. */
  readonly homeDir: string
  /** Isolated Desktop state for selection and preferences. */
  readonly userDataDir: string
}

interface DesktopSafeModeMarkerV1 {
  readonly version: 1
  readonly createdAt: string
}

function absoluteUserDataDir(userDataDir: string): string {
  if (typeof userDataDir !== 'string' || userDataDir.length === 0
    || userDataDir.includes('\0') || !isAbsolute(userDataDir)) {
    throw new TypeError(`${BIN_NAME}: Safe Mode userData must be an absolute path without NUL`)
  }
  return resolve(userDataDir)
}

/** Resolve fixed paths without touching the filesystem. */
export function desktopSafeModePaths(userDataDir: string): DesktopSafeModePaths {
  const rootDir = join(absoluteUserDataDir(userDataDir), SAFE_MODE_DIRECTORY)
  return Object.freeze({
    rootDir,
    homeDir: join(rootDir, 'dsh-home'),
    userDataDir: join(rootDir, 'desktop-state'),
  })
}

function markerPath(paths: DesktopSafeModePaths): string {
  return join(paths.rootDir, SAFE_MODE_MARKER)
}

/** A real directory — NOT a symlink, even if the link target is a directory. */
function isRealDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** True only for a well-formed, size-bounded marker written by this version. */
function validMarker(paths: DesktopSafeModePaths): boolean {
  try {
    const path = markerPath(paths)
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MARKER_BYTES) return false
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (value === null || typeof value !== 'object') return false
    const marker = value as Partial<DesktopSafeModeMarkerV1>
    return marker.version === SAFE_MODE_VERSION
      && typeof marker.createdAt === 'string'
      && Number.isFinite(Date.parse(marker.createdAt))
  } catch {
    return false
  }
}

/**
 * Recursively remove one entry of the disposable tree.
 *
 * A symlink — and any non-directory — is unlinked, never traversed. That is what
 * keeps a link pointing outside the tree from turning into a recursive delete of
 * somebody else's directory.
 */
function removeSafeModeEntry(path: string): void {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      unlinkSync(path)
      return
    }
    for (const name of readdirSync(path)) removeSafeModeEntry(join(path, name))
    rmdirSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
}

/**
 * Remove the disposable tree. Returns whether anything was actually removed, so a
 * caller can tell "cleaned up" from "there was nothing there" (and stays idempotent).
 */
export function cleanupDesktopSafeModeEnvironment(userDataDir: string): boolean {
  const paths = desktopSafeModePaths(userDataDir)
  try {
    lstatSync(paths.rootDir)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
  for (let attempt = 0; ; attempt++) {
    try {
      removeSafeModeEntry(paths.rootDir)
      return true
    } catch (cause) {
      if (attempt >= 3 || !CLEANUP_RETRY_CODES.has((cause as NodeJS.ErrnoException).code ?? '')) throw cause
      // Synchronous backoff: this runs during startup, before any event loop work
      // could drain a timer.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1))
    }
  }
}

/** Create a fresh environment and mark it ready only after directory preparation succeeds. */
export function resetDesktopSafeModeEnvironment(
  userDataDir: string,
  now: () => Date = () => new Date(),
): DesktopSafeModePaths {
  const paths = desktopSafeModePaths(userDataDir)
  cleanupDesktopSafeModeEnvironment(userDataDir)
  try {
    mkdirSync(paths.homeDir, { recursive: true, mode: DIRECTORY_MODE })
    mkdirSync(paths.userDataDir, { recursive: true, mode: DIRECTORY_MODE })
    chmodSync(paths.rootDir, DIRECTORY_MODE)
    chmodSync(paths.homeDir, DIRECTORY_MODE)
    chmodSync(paths.userDataDir, DIRECTORY_MODE)
    // 'wx' rather than 'w': a marker that already exists means something is off,
    // and silently overwriting it would hide that.
    writeFileSync(markerPath(paths), `${JSON.stringify({
      version: SAFE_MODE_VERSION,
      createdAt: now().toISOString(),
    } satisfies DesktopSafeModeMarkerV1, null, 2)}\n`, {
      flag: 'wx',
      mode: FILE_MODE,
    })
    return paths
  } catch (cause) {
    // Never leave a half-built environment behind: the next run would adopt it.
    cleanupDesktopSafeModeEnvironment(userDataDir)
    throw cause
  }
}

/** Adopt the environment prepared for this launch, or repair it with a fresh one. */
export function ensureDesktopSafeModeEnvironment(userDataDir: string): DesktopSafeModePaths {
  const paths = desktopSafeModePaths(userDataDir)
  if (isRealDirectory(paths.rootDir) && validMarker(paths)
    && isRealDirectory(paths.homeDir) && isRealDirectory(paths.userDataDir)) {
    return paths
  }
  return resetDesktopSafeModeEnvironment(userDataDir)
}

/**
 * Prepare an environment with a usable profile already selected.
 *
 * THE ISOLATION TRAP THIS GUARDS AGAINST
 * --------------------------------------
 * `resolveProfileRoots()` resolves `home` from `DSH_HOME` (falling back to `~/.dsh`)
 * and `stateDir` from its argument. The launcher calls it as
 * `resolveProfileRoots({ stateDir: app.getPath('userData') })` — i.e. it passes NO
 * `home`, so the home it actually uses comes from the ENVIRONMENT.
 *
 * That means writing the registry with an explicit `home: paths.homeDir` is not
 * enough on its own: on a real launch the launcher would still compute
 * `~/.dsh`, read a registry that points at `desktop-safe-mode`, and resolve it to
 * `~/.dsh/profiles/desktop-safe-mode` — or fall back to the real `web` profile.
 * Either way the real home is touched, which is precisely what Safe Mode must
 * never do.
 *
 * So this function does two things together:
 *   1. provisions the profile inside the isolated home, and
 *   2. sets `DSH_HOME` to that home, so any subsequent `resolveProfileRoots()`
 *      (with or without an explicit `home`) lands inside the isolation boundary.
 *
 * The returned `roots` are the ones actually used; callers must prefer them over
 * re-deriving their own, and must pass `stateDir` equal to `paths.userDataDir`.
 */
export function prepareDesktopSafeModeEnvironment(userDataDir: string): DesktopSafeModePaths {
  const paths = resetDesktopSafeModeEnvironment(userDataDir)
  try {
    // Point the environment at the isolated home BEFORE resolving roots, so a
    // caller that later calls resolveProfileRoots() without `home` stays isolated.
    process.env.DSH_HOME = paths.homeDir
    const roots = resolveProfileRoots({ stateDir: paths.userDataDir, home: paths.homeDir })
    createProfileDirectory(roots, DESKTOP_SAFE_MODE_PROFILE_NAME)
    writeActiveProfile(roots, DESKTOP_SAFE_MODE_PROFILE_NAME)
    return paths
  } catch (cause) {
    cleanupDesktopSafeModeEnvironment(userDataDir)
    throw cause
  }
}

/**
 * The profile roots Safe Mode must use — derived the same way the launcher does.
 *
 * Exported so callers do not re-derive them and accidentally depend on `DSH_HOME`
 * having already been set (see `prepareDesktopSafeModeEnvironment`).
 */
export function desktopSafeModeRoots(paths: DesktopSafeModePaths): { home: string, stateDir: string } {
  return { home: paths.homeDir, stateDir: paths.userDataDir }
}

/** The throwaway profile's directory, for callers that need to launch against it. */
export function desktopSafeModeProfileDir(paths: DesktopSafeModePaths): string {
  return profileDirFor(paths.homeDir, DESKTOP_SAFE_MODE_PROFILE_NAME)
}
