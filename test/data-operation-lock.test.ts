import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  acquireDataOperationLock,
  dataOperationLockPath,
  withDataOperationLock,
} from '../src/recovery/data-operation-lock.js'

/**
 * The lock guards DSH data mutations (directory changes, factory resets) across
 * processes. Modeled on dsh-desktop's desktop-data-operation-lock: an O_EXCL owner
 * record, one-shot stale-owner recovery, and owned release.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-op-lock-'))
  return { userDataDir: root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('正常获取与释放（锁文件随之消失）', () => {
  const f = fixture()
  try {
    const lease = acquireDataOperationLock(f.userDataDir, 'change-directory')
    assert.equal(lease.operation, 'change-directory')
    assert.equal(existsSync(dataOperationLockPath(f.userDataDir)), true)
    lease.release()
    assert.equal(existsSync(dataOperationLockPath(f.userDataDir)), false)
  } finally {
    f.cleanup()
  }
})

test('持锁期间第二次获取被拒绝并说明持锁操作', () => {
  const f = fixture()
  try {
    const lease = acquireDataOperationLock(f.userDataDir, 'factory-reset')
    assert.throws(
      () => acquireDataOperationLock(f.userDataDir, 'change-directory'),
      (error: unknown) => error instanceof Error && error.message.includes('factory-reset'),
    )
    lease.release()
  } finally {
    f.cleanup()
  }
})

test('崩溃残留的锁会被恢复（持锁进程已不存在）', () => {
  const f = fixture()
  try {
    const path = dataOperationLockPath(f.userDataDir)
    // A record left by a process that no longer exists.
    writeFileSync(path, `${JSON.stringify({
      id: 'stale-id',
      pid: 999_999_999,
      operation: 'factory-reset',
      createdAt: new Date(0).toISOString(),
    })}\n`, 'utf8')
    const lease = acquireDataOperationLock(f.userDataDir, 'change-directory')
    assert.equal(lease.operation, 'change-directory', '应接管死进程的锁')
    lease.release()
  } finally {
    f.cleanup()
  }
})

test('存活进程持有的锁不会被误回收', () => {
  const f = fixture()
  try {
    const path = dataOperationLockPath(f.userDataDir)
    // Our own pid IS alive, so the record must be treated as a genuine conflict.
    writeFileSync(path, `${JSON.stringify({
      id: 'live-id',
      pid: process.pid,
      operation: 'factory-reset',
      createdAt: new Date().toISOString(),
    })}\n`, 'utf8')
    assert.throws(
      () => acquireDataOperationLock(f.userDataDir, 'change-directory'),
      (error: unknown) => error instanceof Error && error.message.includes('factory-reset'),
    )
    // The conflicting record is left untouched for its real owner to release.
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).id, 'live-id')
  } finally {
    f.cleanup()
  }
})

test('withDataOperationLock 在任务抛错时也释放', async () => {
  const f = fixture()
  try {
    await assert.rejects(
      withDataOperationLock(f.userDataDir, 'factory-reset', async () => {
        throw new Error('reset failed halfway')
      }),
      /reset failed/,
    )
    // Released despite the failure — a crashed operation must not lock the app.
    assert.equal(existsSync(dataOperationLockPath(f.userDataDir)), false)
    const lease = acquireDataOperationLock(f.userDataDir, 'retry')
    lease.release()
  } finally {
    f.cleanup()
  }
})

test('锁记录损坏视为 busy（而不是静默接管）', () => {
  const f = fixture()
  try {
    writeFileSync(dataOperationLockPath(f.userDataDir), 'not json at all', 'utf8')
    assert.throws(() => acquireDataOperationLock(f.userDataDir, 'change-directory'), /无效/)
  } finally {
    f.cleanup()
  }
})
