/**
 * Healthy-start configuration checkpoints for recovery.
 *
 * MODELLED ON dsh-desktop's `profile-checkpoint.ts` (895 lines there; trimmed here
 * to the parts we need), with the same three-slot / skip-marker design.
 *
 * WHAT IT DOES
 * ------------
 * A profile can be broken by an edit to a handful of declarative files — a bad
 * plugin in `package.json`, a broken `cordis.patch.yml`. Each HEALTHY startup
 * snapshots those files into one of three rotating slots, so a later failure can
 * roll back to a known-good point.
 *
 * It never runs pnpm and never copies `node_modules`; only the declarative files
 * below are captured.
 *
 * THE PATH MAPPING IS THE DANGEROUS PART
 * --------------------------------------
 * Two entries — `home/settings.yaml` and `home/cordis.patch.yml` — resolve against
 * a SEPARATE harness home, not the profile directory. `home/` is a logical prefix,
 * NOT a real subdirectory of the profile.
 *
 * Get this wrong and the snapshot still "succeeds": files are written, hashes
 * verify, `existsSync` is true — while pointing at a path DSH never reads. The
 * real settings file is never backed up and a restore silently restores nothing.
 * `resolveCheckpointTarget` is the single source of truth for this mapping and is
 * asserted directly by the tests.
 *
 * THE SKIP MARKER
 * ---------------
 * After a restore, the FIRST healthy startup must not snapshot anything: that boot
 * only proves the recovery point works, and snapshotting it would evict an older,
 * possibly more valuable one. The marker is written BEFORE any file is mutated, so
 * a failed restore still preserves the selected point.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const MANIFEST_VERSION = 4
const SKIP_MARKER_VERSION = 1
const SNAPSHOT_ROOT = 'health-snapshots'
const MANIFEST_FILENAME = 'manifest.json'
const SKIP_MARKER_FILENAME = 'skip-next-healthy.json'
const FILE_MODE = 0o600
/** Snapshot directories hold file hashes and structure, so keep them private. */
const DIRECTORY_MODE = 0o700
/** POSIX permission bits are meaningless on Windows; skip the checks there. */
const CHECK_POSIX_MODE = process.platform !== 'win32'

/** The seven declarative files a checkpoint covers. */
export const DESKTOP_PROFILE_CHECKPOINT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'cordis.patch.yml',
  '.dsh-market/state.json',
  'home/settings.yaml',
  'home/cordis.patch.yml',
] as const

export type DesktopProfileCheckpointFilename = typeof DESKTOP_PROFILE_CHECKPOINT_FILES[number]

/** Per-file ceilings; a file beyond its limit fails the capture rather than truncating. */
export const DEFAULT_CHECKPOINT_FILE_LIMITS: Readonly<Record<DesktopProfileCheckpointFilename, number>> = Object.freeze({
  'package.json': 1 * 1024 * 1024,
  'pnpm-lock.yaml': 32 * 1024 * 1024,
  'pnpm-workspace.yaml': 1 * 1024 * 1024,
  'cordis.patch.yml': 1 * 1024 * 1024,
  '.dsh-market/state.json': 1 * 1024 * 1024,
  'home/settings.yaml': 4 * 1024 * 1024,
  'home/cordis.patch.yml': 1 * 1024 * 1024,
})

export const DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3'] as const
export type DesktopProfileCheckpointSlotId = typeof DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS[number]

export interface ProfileCheckpointFileRecord {
  readonly name: DesktopProfileCheckpointFilename
  readonly present: boolean
  readonly sha256?: string
  readonly size?: number
  readonly mode?: number
}

export interface ProfileCheckpointManifest {
  readonly version: typeof MANIFEST_VERSION
  readonly snapshotId: string
  readonly capturedAt: string
  readonly profileName: string
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly reason: 'healthy-startup'
  readonly appVersion: string
  readonly files: readonly ProfileCheckpointFileRecord[]
}

export interface ProfileCheckpointSlot {
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly snapshotExists: boolean
  readonly manifest?: ProfileCheckpointManifest
}

export type CaptureHealthyResult =
  | { readonly status: 'captured', readonly slotId: DesktopProfileCheckpointSlotId }
  | { readonly status: 'skipped-after-restore', readonly restoredSlotId: DesktopProfileCheckpointSlotId }

export interface RestoreInspection {
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly snapshotExists: boolean
  readonly currentDiffers: boolean
  readonly changedFiles: readonly DesktopProfileCheckpointFilename[]
}

export interface RestoreResult {
  readonly status: 'restored'
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly changedFiles: readonly DesktopProfileCheckpointFilename[]
  readonly dependencyMaterializationRequired: boolean
}

export interface ProfileCheckpointOptions {
  readonly userDataDir: string
  readonly profileDir: string
  /** Harness home — the root that `home/*` entries resolve against. */
  readonly homeDir: string
  readonly profileName: string
  readonly appVersion: string
  readonly limits?: Partial<Record<DesktopProfileCheckpointFilename, number>>
  readonly now?: () => number
}

interface LoadedSnapshot {
  readonly directory: string
  readonly manifest: ProfileCheckpointManifest
}

interface SkipHealthyMarker {
  readonly version: typeof SKIP_MARKER_VERSION
  readonly restoredSlotId: DesktopProfileCheckpointSlotId
  readonly restoredAt: string
  readonly dependencyMaterializationPending: boolean
}

/** The file list for a manifest version. We only ever emit v4. */
export function checkpointFiles(version: number): readonly DesktopProfileCheckpointFilename[] {
  if (version !== MANIFEST_VERSION) throw new Error(`unsupported checkpoint manifest version: ${version}`)
  return DESKTOP_PROFILE_CHECKPOINT_FILES
}

/**
 * Resolve one checkpoint entry to an absolute path.
 *
 * THE single place that knows `home/*` entries belong to the harness home rather
 * than the profile. Everything else calls this; nothing re-derives it.
 */
export function resolveCheckpointTarget(
  profileDir: string,
  homeDir: string,
  name: DesktopProfileCheckpointFilename,
): string {
  // 'home/' is a LOGICAL prefix, not a directory inside the profile. Joining it
  // onto profileDir would silently snapshot a file DSH never reads.
  if (name.startsWith('home/')) return join(homeDir, name.slice('home/'.length))
  return join(profileDir, name)
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isENOENT(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function assertSlotId(value: string): DesktopProfileCheckpointSlotId {
  const candidate = DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS.find(id => id === value)
  if (candidate === undefined) throw new Error(`unknown checkpoint slot: ${JSON.stringify(value)}`)
  return candidate
}

/** Write a file and flush it, so a crash cannot leave a half-written checkpoint. */
function writeDurable(path: string, bytes: Buffer, mode = FILE_MODE): void {
  ensureDirectory(dirname(path))
  const descriptor = openSync(path, 'w', mode)
  try {
    writeSync(descriptor, bytes)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Create a directory with restrictive permissions and flush the parent, so the
 * entry itself survives a power failure.
 *
 * `mkdirSync`'s mode argument is masked by the process umask, so on POSIX we chmod
 * explicitly — a snapshot directory holding file hashes should not be world
 * readable at the umask default.
 */
function ensureDirectory(dir: string): void {
  const parent = dirname(dir)
  mkdirSync(dir, { recursive: true, mode: DIRECTORY_MODE })
  if (CHECK_POSIX_MODE) {
    try {
      chmodSync(dir, DIRECTORY_MODE)
    } catch {
      // Best effort: a pre-existing directory owned by someone else must not
      // abort an otherwise valid capture.
    }
  }
  try {
    const descriptor = openSync(parent, 'r')
    try {
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
  } catch {
    // Directory fsync is not portable (notably on Windows); its absence only
    // weakens durability, so it must never fail the operation.
  }
}

/** Refuse to snapshot or restore through a symlink or non-regular file. */
function assertRegularFile(path: string, what: string): void {
  const item = lstatSync(path)
  if (item.isSymbolicLink() || !item.isFile()) throw new Error(`${what} must be a regular file: ${path}`)
}

interface FileImage {
  readonly present: boolean
  readonly sha256?: string
  readonly size?: number
  readonly mode?: number
}

function fileEqual(left: ProfileCheckpointFileRecord, right: FileImage): boolean {
  if (left.present !== right.present) return false
  if (!left.present) return true
  return left.sha256 === right.sha256 && left.size === right.size
}

export function createDesktopProfileCheckpoint(options: ProfileCheckpointOptions) {
  const profileDir = options.profileDir
  const homeDir = options.homeDir
  const limits: Record<DesktopProfileCheckpointFilename, number> = {
    ...DEFAULT_CHECKPOINT_FILE_LIMITS,
    ...options.limits,
  }
  const now = options.now ?? (() => Date.now())
  /** Snapshots live beside the profile, keyed by profile name. */
  const snapshotRoot = join(options.userDataDir, SNAPSHOT_ROOT, options.profileName)

  function slotDirectory(slotId: DesktopProfileCheckpointSlotId): string {
    return join(snapshotRoot, slotId)
  }

  /** Read the current on-disk image of each requested file. */
  function readCurrentImages(
    names: readonly DesktopProfileCheckpointFilename[],
    target?: { readonly profileDir: string, readonly homeDir: string },
  ): FileImage[] {
    return names.map(name => {
      const path = resolveCheckpointTarget(
        target?.profileDir ?? profileDir,
        target?.homeDir ?? homeDir,
        name,
      )
      let item
      try {
        item = lstatSync(path)
      } catch (cause) {
        if (isENOENT(cause)) return { present: false }
        throw cause
      }
      if (item.isSymbolicLink() || !item.isFile()) throw new Error(`checkpoint entry must be a regular file: ${name}`)
      if (item.size > limits[name]) throw new Error(`profile checkpoint file is too large: ${name}`)
      const bytes = readFileSync(path)
      return { present: true, sha256: hash(bytes), size: bytes.byteLength, mode: item.mode & 0o777 }
    })
  }

  /**
   * Load one slot's manifest, treating ANY unreadable or malformed state as
   * "this slot is empty" rather than as a fatal error.
   *
   * WHY THIS IS TOLERANT
   * --------------------
   * The three slots exist to be INDEPENDENT recovery points, and a snapshot is
   * taken on every healthy startup. If a single corrupt manifest propagated, then
   * `listSlots()` (used by the slot-selection logic inside `captureHealthy`) would
   * throw and **every future capture would be blocked** — one bad byte anywhere
   * would permanently disable checkpointing, including for the healthy slots.
   *
   * A manifest from a newer build (say v5, after a downgrade) is treated the same
   * way: unknown, so unusable by this version, but not a reason to fail the whole
   * mechanism. It also must not be silently rewritten as v4 — `snapshotExists` is
   * reported false so the slot is simply recycled by a later capture.
   */
  function readSnapshot(directory: string): LoadedSnapshot | undefined {
    const manifestPath = join(directory, MANIFEST_FILENAME)
    let raw: string
    try {
      raw = readFileSync(manifestPath, 'utf8')
    } catch (cause) {
      if (isENOENT(cause)) return undefined
      // A directory where the manifest should be, or unreadable permissions:
      // degrade to "empty slot" for the same reason as above.
      return undefined
    }
    try {
      const manifest = JSON.parse(raw) as ProfileCheckpointManifest
      if (manifest.version !== MANIFEST_VERSION) return undefined
      if (!Array.isArray(manifest.files) || manifest.files.length !== checkpointFiles(manifest.version).length) {
        return undefined
      }
      if (typeof manifest.capturedAt !== 'string' || !Number.isFinite(Date.parse(manifest.capturedAt))) {
        return undefined
      }
      return { directory, manifest }
    } catch {
      return undefined
    }
  }

  function readSkipMarker(): SkipHealthyMarker | undefined {
    const path = join(snapshotRoot, SKIP_MARKER_FILENAME)
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch (cause) {
      if (isENOENT(cause)) return undefined
      throw cause
    }
    const marker = JSON.parse(raw) as SkipHealthyMarker
    if (marker.version !== SKIP_MARKER_VERSION) throw new Error('skip healthy marker is invalid')
    return { ...marker, restoredSlotId: assertSlotId(marker.restoredSlotId) }
  }

  /** Swap a freshly built staging directory into the slot, atomically. */
  function replaceSlot(target: string, staging: string): void {
    if (!existsSync(target)) {
      renameSync(staging, target)
      return
    }
    const old = `${target}.old-${randomUUID()}`
    renameSync(target, old)
    try {
      renameSync(staging, target)
    } catch (cause) {
      renameSync(old, target)
      throw cause
    }
    rmSync(old, { recursive: true, force: true })
  }

  /**
   * Recover from a crash during a slot replacement.
   *
   * Two distinct kinds of debris can be left behind:
   *
   *   - `<slot>.old-*` — the previous snapshot after the first rename but before
   *     the second. It is put BACK, because it is a complete, valid snapshot and
   *     losing it would silently destroy a recovery point.
   *   - `<slot>.staging-*` — a half-built snapshot. It is REMOVED, because an
   *     incomplete staging directory is worthless and, left alone, would
   *     accumulate on every crash. The in-process `catch` only covers failures
   *     that unwind normally; a hard crash leaks them, and nothing else cleans up.
   */
  function recoverOrphanedSlots(): void {
    for (const slotId of DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS) {
      const target = slotDirectory(slotId)
      let entries: string[]
      try {
        entries = readdirSync(snapshotRoot)
      } catch (cause) {
        if (isENOENT(cause)) return
        throw cause
      }

      // Discard incomplete staging directories for this slot.
      for (const name of entries.filter(entry => entry.startsWith(`${slotId}.staging-`))) {
        rmSync(join(snapshotRoot, name), { recursive: true, force: true })
      }

      if (existsSync(target)) continue
      const candidates = entries
        .filter(name => name.startsWith(`${slotId}.old-`))
        .sort()
        .reverse()
      for (const name of candidates) {
        const candidate = join(snapshotRoot, name)
        try {
          const item = lstatSync(candidate)
          if (!item.isDirectory() || item.isSymbolicLink()) continue
          renameSync(candidate, target)
          break
        } catch (cause) {
          if (!isENOENT(cause)) throw cause
        }
      }
    }
  }

  function listSlots(): readonly ProfileCheckpointSlot[] {
    return DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS.map(slotId => {
      const directory = slotDirectory(slotId)
      const snapshot = existsSync(directory) ? readSnapshot(directory) : undefined
      return {
        slotId,
        snapshotExists: snapshot !== undefined,
        ...(snapshot === undefined ? {} : { manifest: snapshot.manifest }),
      }
    })
  }

  /**
   * Snapshot the current files into a slot — unless a restore just happened, in
   * which case consume the marker and snapshot nothing.
   */
  function captureHealthy(): CaptureHealthyResult {
    recoverOrphanedSlots()
    const names = checkpointFiles(MANIFEST_VERSION)
    const current = readCurrentImages(names)

    const skip = readSkipMarker()
    if (skip !== undefined) {
      unlinkSync(join(snapshotRoot, SKIP_MARKER_FILENAME))
      return { status: 'skipped-after-restore', restoredSlotId: skip.restoredSlotId }
    }

    const slots = listSlots()
    const empty = slots.find(slot => !slot.snapshotExists)
    // Prefer an empty slot; otherwise recycle the OLDEST. slotId breaks ties so the
    // choice is deterministic rather than dependent on readdir order.
    const target = empty ?? [...slots].sort((left, right) => {
      const leftTime = Date.parse(left.manifest!.capturedAt)
      const rightTime = Date.parse(right.manifest!.capturedAt)
      return leftTime - rightTime || left.slotId.localeCompare(right.slotId)
    })[0]!

    const snapshotId = randomUUID()
    const staging = `${slotDirectory(target.slotId)}.staging-${process.pid}-${snapshotId}`
    ensureDirectory(staging)
    try {
      const records: ProfileCheckpointFileRecord[] = []
      for (const [index, name] of names.entries()) {
        const image = current[index]!
        records.push({ name, ...image })
        if (image.present) {
          const destination = join(staging, name)
          ensureDirectory(dirname(destination))
          writeDurable(destination, readFileSync(resolveCheckpointTarget(profileDir, homeDir, name)))
        }
      }
      const manifest: ProfileCheckpointManifest = {
        version: MANIFEST_VERSION,
        snapshotId,
        capturedAt: new Date(now()).toISOString(),
        profileName: options.profileName,
        slotId: target.slotId,
        reason: 'healthy-startup',
        appVersion: options.appVersion,
        files: records,
      }
      writeDurable(join(staging, MANIFEST_FILENAME), Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8'))
      replaceSlot(slotDirectory(target.slotId), staging)
      return { status: 'captured', slotId: target.slotId }
    } catch (cause) {
      rmSync(staging, { recursive: true, force: true })
      throw cause
    }
  }

  function inspectSlot(slotId: DesktopProfileCheckpointSlotId): RestoreInspection {
    const resolvedSlot = assertSlotId(slotId)
    const snapshot = readSnapshot(slotDirectory(resolvedSlot))
    if (snapshot === undefined) {
      return { slotId: resolvedSlot, snapshotExists: false, currentDiffers: false, changedFiles: [] }
    }
    const names = checkpointFiles(snapshot.manifest.version)
    const current = readCurrentImages(names)
    const changedFiles = names.filter((_, index) => !fileEqual(snapshot.manifest.files[index]!, current[index]!))
    return { slotId: resolvedSlot, snapshotExists: true, currentDiffers: changedFiles.length > 0, changedFiles }
  }

  /** Restore one slot, preserving it across the next healthy boot. */
  /**
   * Restore a slot's recorded files.
   *
   * `writeTarget` separates READING a slot from WRITING it back:
   *
   *   - The slot always lives under THIS instance's snapshot root, so this instance
   *     must be the one constructed for the slot's OWNING profile.
   *   - The files are written into `writeTarget` when given, otherwise into this
   *     instance's own profile.
   *
   * That split is what lets the recovery page roll a snapshot taken in one profile
   * into a DIFFERENT profile — the user's requirement that slots not be welded to a
   * profile. The data structure is unchanged (per-profile slot directories, each
   * manifest recording its `profileName`); only the write destination moves.
   *
   * The skip marker stays in THIS instance's snapshot root on purpose: it guards the
   * slot the user just restored FROM, so a later healthy startup cannot overwrite the
   * recovery point they chose.
   */
  function restoreSlot(
    slotId: DesktopProfileCheckpointSlotId,
    writeTarget?: { readonly profileDir: string, readonly homeDir: string },
  ): RestoreResult {
    const resolvedSlot = assertSlotId(slotId)
    const directory = slotDirectory(resolvedSlot)
    const snapshot = readSnapshot(directory)
    if (snapshot === undefined) throw new Error(`checkpoint ${resolvedSlot} is empty`)

    const names = checkpointFiles(snapshot.manifest.version)
    const current = readCurrentImages(names, writeTarget)
    const changedFiles = names.filter((_, index) => !fileEqual(snapshot.manifest.files[index]!, current[index]!))
    const previous = readSkipMarker()
    const dependencyMaterializationRequired = previous?.dependencyMaterializationPending === true
      || changedFiles.some(name => name === 'package.json' || name === 'pnpm-lock.yaml' || name === 'pnpm-workspace.yaml')

    // Write the marker BEFORE mutating anything. A failed restore must not let a
    // later healthy startup overwrite the recovery point the user selected.
    writeDurable(join(snapshotRoot, SKIP_MARKER_FILENAME), Buffer.from(`${JSON.stringify({
      version: SKIP_MARKER_VERSION,
      restoredSlotId: resolvedSlot,
      restoredAt: new Date(now()).toISOString(),
      dependencyMaterializationPending: dependencyMaterializationRequired,
    } satisfies SkipHealthyMarker)}\n`, 'utf8'))

    for (const [index, name] of names.entries()) {
      const record = snapshot.manifest.files[index]!
      const target = resolveCheckpointTarget(
        writeTarget?.profileDir ?? profileDir,
        writeTarget?.homeDir ?? homeDir,
        name,
      )
      if (record.present) {
        const source = join(directory, name)
        const bytes = readFileSync(source)
        // The snapshot must not change under us mid-restore.
        if (hash(bytes) !== record.sha256 || bytes.byteLength !== record.size) {
          throw new Error(`checkpoint changed during restore: ${name}`)
        }
        writeDurable(target, bytes, record.mode)
      } else {
        // The snapshot recorded an ABSENT file, so restoring means removing it —
        // but never through a symlink.
        try {
          assertRegularFile(target, 'checkpoint target')
          unlinkSync(target)
        } catch (cause) {
          if (!isENOENT(cause)) throw cause
        }
      }
    }
    return { status: 'restored', slotId: resolvedSlot, changedFiles, dependencyMaterializationRequired }
  }

  /** Clear the pending dependency work, keeping the marker that guards the boot. */
  function completeDependencyMaterialization(slotId: DesktopProfileCheckpointSlotId): void {
    const resolvedSlot = assertSlotId(slotId)
    const marker = readSkipMarker()
    if (marker === undefined || marker.restoredSlotId !== resolvedSlot) {
      throw new Error('checkpoint materialization completion does not match the active restore')
    }
    if (!marker.dependencyMaterializationPending) return
    writeDurable(join(snapshotRoot, SKIP_MARKER_FILENAME), Buffer.from(`${JSON.stringify({
      ...marker,
      dependencyMaterializationPending: false,
    } satisfies SkipHealthyMarker)}\n`, 'utf8'))
  }

  function clear(): void {
    rmSync(snapshotRoot, { recursive: true, force: true })
  }

  return {
    profileDir,
    homeDir,
    snapshotRoot,
    listSlots,
    captureHealthy,
    inspectSlot,
    restoreSlot,
    completeDependencyMaterialization,
    clear,
  }
}

export type DesktopProfileCheckpoint = ReturnType<typeof createDesktopProfileCheckpoint>

/**
 * Remove every checkpoint for a profile.
 *
 * A standalone entry point (rather than only an instance method) because the caller
 * that needs it — deleting a profile — has no checkpoint instance, and should not
 * have to construct one just to clear its state.
 */
export function clearDesktopProfileCheckpoint(userDataDir: string, profileName: string): void {
  rmSync(join(userDataDir, SNAPSHOT_ROOT, profileName), { recursive: true, force: true })
}
