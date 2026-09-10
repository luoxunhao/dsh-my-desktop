/**
 * Desktop-owned DSH home selection.
 *
 * MODELLED ON dsh-desktop's `desktop-data-directory.ts`, trimmed to what the
 * recovery page needs.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The data directory (our `DSH_HOME`, normally `~/.dsh`) can end up somewhere the
 * app cannot use — on a detached drive, behind a broken link, or simply a location
 * the user wants to move away from. When that happens the app cannot start, so the
 * recovery page has to be able to point it somewhere else. This module owns that
 * choice.
 *
 * IT NEVER MOVES DATA
 * -------------------
 * Switching only changes where the app LOOKS. Nothing is copied, and the previous
 * home is left untouched — that is what makes the operation reversible and fast,
 * and it is why the UI must say so explicitly.
 *
 * THE PRIORITY DIRECTION IS DELIBERATE
 * ------------------------------------
 * A state file written by the user WINS over `DSH_HOME`:
 *
 *     state file present  →  use it, source = 'desktop'
 *     state file absent   →  use the fallback, source = 'environment' | 'default'
 *
 * Choosing a directory in the recovery page is an explicit act of intent. If an
 * environment variable could silently override it, the user would change the
 * setting, see no effect, and have no way to discover why. `source` is reported to
 * the page so it can explain who decided the current value.
 *
 * SAFETY REFUSALS
 * ---------------
 * A target is refused when it is relative, missing, a symlink, a filesystem root, or
 * would CONTAIN the app's own state directory. The last one matters most: putting
 * the data home above userData would mean the app manages a tree that holds its own
 * state.
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'

const STATE_VERSION = 1
const STATE_ROOT_DIRECTORY = 'data-directory'
const STATE_FILENAME = 'state.json'
const STATE_DIRECTORY_MODE = 0o700
const STATE_FILE_MODE = 0o600
const MAX_STATE_BYTES = 64 * 1024
/** POSIX mode bits are meaningless on Windows. */
const CHECK_POSIX_MODE = process.platform !== 'win32'

/** Where the current data directory came from. */
export type DataDirectorySource = 'default' | 'environment' | 'desktop'

export type DataDirectoryErrorCode =
  | 'busy'
  | 'invalid-path'
  | 'path-conflict'
  | 'source-unavailable'
  | 'target-invalid'
  | 'target-unavailable'

export class DataDirectoryError extends Error {
  constructor(
    readonly code: DataDirectoryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DataDirectoryError'
  }
}

interface DataDirectoryStateV1 {
  readonly version: 1
  readonly activeHome: string
  /** The directory in use before the most recent switch, for reverting. */
  readonly previousHome: string | null
  readonly generation: number
  readonly updatedAt: string
}

export interface DataDirectoryLocation {
  readonly homeDir: string
  readonly previousHome: string | null
  readonly generation: number
  readonly source: DataDirectorySource
}

export interface ResolveOptions {
  /** Used when no state file exists. */
  readonly fallbackHome: string
  /** Which of the two fallback kinds applies — report only, not a priority. */
  readonly fallbackSource: 'default' | 'environment'
}

/** Where the state file lives. Exported so tests and callers never re-derive it. */
export function dataDirectoryStatePath(userDataDir: string): string {
  return join(userDataDir, STATE_ROOT_DIRECTORY, STATE_FILENAME)
}

function isRealDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path)
    // A symlink is NOT a real directory even when it points at one: following it
    // would let a link decide where the user's data lands.
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function comparisonKey(path: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = resolve(path)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Whether `child` is inside `parent` (or equal to it). */
function contains(parent: string, child: string): boolean {
  const suffix = relative(comparisonKey(parent), comparisonKey(child))
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix))
}

function assertAbsolute(path: string, label: string): string {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || !isAbsolute(path)) {
    throw new DataDirectoryError('invalid-path', `${label} must be an absolute path`)
  }
  return resolve(path)
}

/** Parse a state file, treating anything malformed as "no state". */
function parseState(raw: string): DataDirectoryStateV1 | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const candidate = value as Partial<DataDirectoryStateV1>
    if (candidate.version !== STATE_VERSION) return undefined
    if (typeof candidate.activeHome !== 'string' || !isAbsolute(candidate.activeHome)) return undefined
    if (candidate.previousHome !== null && typeof candidate.previousHome !== 'string') return undefined
    if (typeof candidate.generation !== 'number' || !Number.isInteger(candidate.generation)) return undefined
    if (typeof candidate.updatedAt !== 'string' || !Number.isFinite(Date.parse(candidate.updatedAt))) return undefined
    return candidate as DataDirectoryStateV1
  } catch {
    return undefined
  }
}

/**
 * Read the state file, or `undefined` when there is none OR it is unusable.
 *
 * Unusable state degrades to "no state" rather than throwing: a corrupt file must
 * not stop the app from starting, and the fallback is always a working directory.
 */
export function readDataDirectoryState(userDataDir: string): DataDirectoryStateV1 | undefined {
  const path = dataDirectoryStatePath(userDataDir)
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE_BYTES) return undefined
    return parseState(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Durable write so a crash cannot leave a half-written state file. */
function writeState(userDataDir: string, state: DataDirectoryStateV1 | null): void {
  const path = dataDirectoryStatePath(userDataDir)
  if (state === null) {
    rmSync(path, { force: true })
    return
  }
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: STATE_DIRECTORY_MODE })
  if (CHECK_POSIX_MODE) chmodSync(directory, STATE_DIRECTORY_MODE)
  const staging = `${path}.staging-${process.pid}`
  const descriptor = openSync(staging, 'w', STATE_FILE_MODE)
  try {
    writeSync(descriptor, `${JSON.stringify(state, null, 2)}\n`)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(staging, path)
}

/**
 * Resolve the effective data directory.
 *
 * A state file wins over the fallback — see the module header for why. A state file
 * pointing at a directory that no longer exists is an error rather than a silent
 * fallback: silently using a different home would make the app fail somewhere far
 * from the actual cause.
 */
export function resolveDataDirectory(userDataDir: string, options: ResolveOptions): DataDirectoryLocation {
  const state = readDataDirectoryState(userDataDir)
  if (state === undefined) {
    return {
      homeDir: resolve(options.fallbackHome),
      previousHome: null,
      generation: 0,
      source: options.fallbackSource,
    }
  }
  if (!isRealDirectory(state.activeHome)) {
    throw new DataDirectoryError(
      'source-unavailable',
      `the configured data directory is missing or is not a real directory: ${state.activeHome}`,
    )
  }
  return {
    homeDir: state.activeHome,
    previousHome: state.previousHome,
    generation: state.generation,
    source: 'desktop',
  }
}

/**
 * Validate a candidate target.
 *
 * Every refusal here prevents a specific way of losing data or leaving the app
 * unusable, so they are asserted by tests rather than left to review.
 */
function assertUsableTarget(target: string, userDataDir: string): string {
  const resolved = assertAbsolute(target, 'data directory')

  // A filesystem root would make a later "reset" catastrophic.
  if (comparisonKey(resolved) === comparisonKey(parse(resolved).root)) {
    throw new DataDirectoryError('target-invalid', `refusing a filesystem root: ${resolved}`)
  }
  // The data home must not contain the app's own state: the app would then manage
  // a tree that holds its state, and a reset would delete the app's own files.
  if (contains(resolved, userDataDir)) {
    throw new DataDirectoryError('path-conflict', `refusing a directory that contains the app state: ${resolved}`)
  }
  if (!existsSync(resolved)) {
    throw new DataDirectoryError('target-unavailable', `data directory does not exist: ${resolved}`)
  }
  if (!isRealDirectory(resolved)) {
    throw new DataDirectoryError('target-invalid', `data directory must be a real directory: ${resolved}`)
  }
  return resolved
}

/**
 * Point the app at a different data directory, or pass `null` to clear the choice
 * and fall back to the default.
 *
 * Nothing is copied. The previous home is recorded so the change can be reverted.
 */
export function selectDataDirectory(
  userDataDir: string,
  target: string | null,
  options: { defaultHome: string, now?: () => number },
): DataDirectoryLocation {
  if (target === null) {
    writeState(userDataDir, null)
    return {
      homeDir: resolve(options.defaultHome),
      previousHome: null,
      generation: 0,
      source: 'default',
    }
  }

  const resolved = assertUsableTarget(target, userDataDir)
  const previous = readDataDirectoryState(userDataDir)
  const generation = (previous?.generation ?? 0) + 1
  const state: DataDirectoryStateV1 = {
    version: STATE_VERSION,
    activeHome: resolved,
    // Remember where we came from so "revert" needs no extra bookkeeping.
    previousHome: previous?.activeHome ?? null,
    generation,
    updatedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
  }
  writeState(userDataDir, state)
  return { homeDir: resolved, previousHome: state.previousHome, generation, source: 'desktop' }
}
