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
  mkdirSync(dirname(path), { recursive: true })
  const descriptor = openSync(path, 'w', mode)
  try {
    writeSync(descriptor, bytes)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function ensureDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true })
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
  function readCurrentImages(names: readonly DesktopProfileCheckpointFilename[]): FileImage[] {
    return names.map(name => {
      const path = resolveCheckpointTarget(profileDir, homeDir, name)
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

  function readSnapshot(directory: string): LoadedSnapshot | undefined {
    const manifestPath = join(directory, MANIFEST_FILENAME)
    let raw: string
    try {
      raw = readFileSync(manifestPath, 'utf8')
    } catch (cause) {
      if (isENOENT(cause)) return undefined
      throw cause
    }
    const manifest = JSON.parse(raw) as ProfileCheckpointManifest
    if (manifest.version !== MANIFEST_VERSION) throw new Error(`unsupported checkpoint manifest version: ${manifest.version}`)
    if (manifest.files.length !== checkpointFiles(manifest.version).length) {
      throw new Error('checkpoint manifest is invalid')
    }
    return { directory, manifest }
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

  /** A crash between the two renames leaves `<slot>.old-*`; put it back. */
  function recoverOrphanedSlots(): void {
    for (const slotId of DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS) {
      const target = slotDirectory(slotId)
      if (existsSync(target)) continue
      let candidates: string[]
      try {
        candidates = readdirSync(snapshotRoot)
          .filter(name => name.startsWith(`${slotId}.old-`))
          .sort()
          .reverse()
      } catch (cause) {
        if (isENOENT(cause)) continue
        throw cause
      }
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
  function restoreSlot(slotId: DesktopProfileCheckpointSlotId): RestoreResult {
    const resolvedSlot = assertSlotId(slotId)
    const directory = slotDirectory(resolvedSlot)
    const snapshot = readSnapshot(directory)
    if (snapshot === undefined) throw new Error(`checkpoint ${resolvedSlot} is empty`)

    const names = checkpointFiles(snapshot.manifest.version)
    const current = readCurrentImages(names)
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
      const target = resolveCheckpointTarget(profileDir, homeDir, name)
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
