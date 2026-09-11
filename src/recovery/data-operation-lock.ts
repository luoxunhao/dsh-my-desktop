/**
 * Cross-process exclusion for DSH data mutations owned by the launcher.
 *
 * WHY A FILE LOCK
 * ---------------
 * Data-directory changes and factory resets move or delete the whole DSH home. Two
 * such operations racing — say a factory reset started while a directory change is
 * mid-flight — would interleave into a half-migrated state that neither operation's
 * error handling describes. The busy gate in the recovery page only stops ONE
 * renderer's double clicks; a second window, or the settings plugin, is a different
 * surface entirely.
 *
 * MODELLED ON dsh-desktop's `desktop-data-operation-lock.ts`. An owner record
 * (id/pid/operation/createdAt) is created with O_EXCL; a stale record whose process
 * no longer exists is recovered once, so a crashed run cannot lock the app forever.
 * The lock is advisory but owned: release verifies the record still belongs to the
 * acquirer before unlinking.
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const MAX_LOCK_BYTES = 8 * 1024
const LOCK_FILENAME = 'operation.lock'

interface LockRecord {
  readonly id: string
  readonly pid: number
  readonly operation: string
  readonly createdAt: string
}

export interface DataOperationLease {
  readonly id: string
  readonly operation: string
  release(): void
}

/** Thrown when the lock is held elsewhere or its record is unusable. */
export class DataOperationBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataOperationBusyError'
  }
}

/** Where the lock file lives, matching the reference's placement beside the state file. */
export function dataOperationLockPath(userDataDir: string): string {
  return join(userDataDir, 'operation.lock')
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function readRecord(path: string): LockRecord {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_LOCK_BYTES) {
    throw new DataOperationBusyError('数据操作锁文件不安全')
  }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    throw new DataOperationBusyError('数据操作锁记录无效')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataOperationBusyError('数据操作锁记录无效')
  }
  const row = value as Record<string, unknown>
  if (
    Object.keys(row).sort().join(',') !== 'createdAt,id,operation,pid'
    || typeof row.id !== 'string' || typeof row.operation !== 'string'
    || !Number.isSafeInteger(row.pid) || (row.pid as number) <= 0
    || typeof row.createdAt !== 'string'
  ) {
    throw new DataOperationBusyError('数据操作锁记录无效')
  }
  return { id: row.id, pid: row.pid as number, operation: row.operation, createdAt: row.createdAt }
}

function prepareDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIRECTORY_MODE })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new DataOperationBusyError('数据操作锁目录不安全')
  }
}

/**
 * Acquire the lock for one data operation.
 *
 * Exactly two attempts: the first collision recovers a stale record if its owner
 * process is gone, and any second collision is a genuine busy. Throwing `busy`
 * rather than waiting keeps the UI's error message truthful ("另一项数据操作正在进行")
 * instead of promising a wait that the user cannot see.
 */
export function acquireDataOperationLock(userDataDir: string, operation: string): DataOperationLease {
  if (operation.length === 0 || operation.length > 128 || operation.includes('\0')) {
    throw new DataOperationBusyError('数据操作名不合法')
  }
  const path = dataOperationLockPath(userDataDir)
  prepareDirectory(dirname(path))
  const id = randomUUID()
  const record: LockRecord = { id, pid: process.pid, operation, createdAt: new Date().toISOString() }
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor: number
    try {
      descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, FILE_MODE)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
      const owner = readRecord(path)
      if (attempt === 0 && !processExists(owner.pid)) {
        // The previous owner died holding the lock; recover it once.
        unlinkSync(path)
        continue
      }
      throw new DataOperationBusyError(`另一项数据操作正在进行：${owner.operation}`)
    }
    try {
      const info = fstatSync(descriptor)
      if (!info.isFile()) throw new DataOperationBusyError('数据操作锁文件不安全')
      writeSync(descriptor, bytes)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    let released = false
    return Object.freeze({
      id,
      operation,
      release: () => {
        if (released) return
        released = true
        const current = readRecord(path)
        if (current.id !== id || current.pid !== process.pid) {
          throw new DataOperationBusyError('数据操作锁的所有权已变更')
        }
        unlinkSync(path)
      },
    })
  }
  throw new DataOperationBusyError('另一项数据操作正在进行')
}

/** Run one data operation under the lock, releasing even when it throws. */
export async function withDataOperationLock<T>(
  userDataDir: string,
  operation: string,
  task: () => Promise<T>,
): Promise<T> {
  const lease = acquireDataOperationLock(userDataDir, operation)
  try {
    return await task()
  } finally {
    lease.release()
  }
}
