/**
 * Factory reset for the active Desktop-owned DSH data directory.
 *
 * MODELLED ON dsh-desktop's `desktop-factory-reset.ts`. The safety assertions live
 * in their own function so they can be reasoned about — and tested — on their own,
 * without a running app or a real trash.
 *
 * THIS IS THE MOST DESTRUCTIVE OPERATION IN THE PRODUCT
 * ----------------------------------------------------
 * It removes the user's entire DSH home: every profile, every plugin, every
 * setting. Two things make that acceptable:
 *
 *   1. **It goes to the OS trash, not the void.** `trashItem` is injected rather
 *      than imported so the boundary stays testable, but the real adapter is
 *      `shell.trashItem` — the user can still recover the directory. Deletion would
 *      turn "factory reset" into "data loss".
 *   2. **Four refusals run first**, each preventing a specific way of destroying
 *      more than intended:
 *
 *        - a filesystem root          — would trash an entire volume
 *        - a symlink / non-directory  — would follow a link out of the intended tree
 *        - a directory CONTAINING protected paths (the app's own userData)
 *        - an uninitialized DSH home  — "resetting" something that was never ours
 *
 * The containment check is the subtle one: userData normally sits OUTSIDE the DSH
 * home, but a user can configure a data directory (see `data-directory.ts`) such
 * that it ends up inside — and then resetting the home would take the app's own
 * state with it, leaving an install that cannot remember anything.
 */
import { lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

const DIRECTORY_MODE = 0o700
const MAX_PATH_BYTES = 32 * 1024

export interface FactoryResetOptions {
  /** The active DSH home, as resolved by the launcher. */
  readonly homeDir: string
  /** The app's own user-data directory; always protected. */
  readonly userDataDir: string
  /** Extra directories that must never be reset or contained by the reset root. */
  readonly protectedPaths: readonly string[]
  /** Trash adapter (real one is `shell.trashItem`), injected so this stays testable. */
  readonly trashItem: (path: string) => Promise<void>
  /** Recreate an empty home afterwards so the next start is clean. */
  readonly recreate: boolean
}

function canonicalPath(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
    || !isAbsolute(value) || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) {
    throw new Error(`${label} must be a bounded absolute path without NUL`)
  }
  return resolve(value)
}

function comparisonKey(path: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = resolve(path)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Whether `child` is inside `parent` (or is `parent` itself). */
function contains(parent: string, child: string): boolean {
  const suffix = relative(comparisonKey(parent), comparisonKey(child))
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}

function isRealDirectory(path: string): boolean {
  try {
    const info = lstatSync(path)
    // A symlink is not a real directory even when it points at one — following it
    // would let a link decide which tree gets trashed.
    return info.isDirectory() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Validate the reset target, or throw.
 *
 * Fail closed: every refusal happens BEFORE anything is handed to the trash, so a
 * rejected target leaves the filesystem untouched.
 */
export function assertFactoryResetTarget(
  homeDir: string,
  protectedPaths: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const target = canonicalPath(homeDir, 'factory-reset data directory')
  if (comparisonKey(target, platform) === comparisonKey(parse(target).root, platform)) {
    throw new Error('refusing to reset a filesystem root')
  }
  if (!isRealDirectory(target)) {
    throw new Error('factory-reset data directory must be a real directory')
  }
  for (const candidate of protectedPaths) {
    const protectedPath = canonicalPath(candidate, 'protected path')
    if (contains(target, protectedPath)) {
      throw new Error('refusing to reset a directory that contains protected desktop or user files')
    }
  }
  // A home without `profiles` is not one of ours; resetting it would be guessing.
  if (!isRealDirectory(join(target, 'profiles'))) {
    throw new Error('factory-reset target is not an initialized DSH home')
  }
  return target
}

/**
 * Move the DSH home to the trash, then optionally recreate an empty one.
 *
 * The profile names are read BEFORE the trash so that a caller can clear the
 * per-profile state that lives outside the home (preferences, checkpoints). Those
 * records are keyed by path, so leaving them behind would silently restore
 * pre-reset settings into the freshly created home.
 */
export async function factoryResetDataDirectory(options: FactoryResetOptions): Promise<{
  readonly target: string
  readonly profileNames: readonly string[]
}> {
  const userDataDir = canonicalPath(options.userDataDir, 'factory-reset user-data directory')
  // userData is ALWAYS protected, whether or not the caller listed it.
  const target = assertFactoryResetTarget(options.homeDir, [...options.protectedPaths, userDataDir])

  const profileNames = readdirSync(join(target, 'profiles'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)

  await options.trashItem(target)

  if (options.recreate) {
    mkdirSync(target, { recursive: false, mode: DIRECTORY_MODE })
    if (!isRealDirectory(target)) {
      throw new Error('factory-reset data directory could not be recreated safely')
    }
  }
  return { target, profileNames }
}
