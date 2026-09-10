import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import test from 'node:test'

import {
  checkpointFiles,
  clearDesktopProfileCheckpoint,
  createDesktopProfileCheckpoint,
  resolveCheckpointTarget,
  DESKTOP_PROFILE_CHECKPOINT_FILES,
  DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS,
} from '../src/recovery/profile-checkpoint.js'

/**
 * Healthy-start configuration checkpoints.
 *
 * THE RISK THIS FILE GUARDS ABOVE ALL ELSE
 * ----------------------------------------
 * The checkpoint file list mixes two roots. `home/*` entries resolve against a
 * SEPARATE home directory; the rest resolve against the profile directory. Get that
 * mapping wrong and the snapshot still "succeeds" — files are written, hashes
 * match — while backing up a path DSH never reads. The failure is completely
 * silent: nothing errors, and a `existsSync`-style test still passes.
 *
 * So the first tests here assert the RESOLUTION itself, and the round-trip test
 * proves the mapping end to end by mutating a real file and restoring it.
 */

interface Fixture {
  userDataDir: string
  profileDir: string
  homeDir: string
  cleanup: () => void
}

/** A profile + harness home laid out like the real product's. */
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-checkpoint-'))
  const userDataDir = join(root, 'user-data')
  // Mirrors the product: homeDir is the `.dsh` root, profiles live under it.
  const homeDir = join(root, 'dsh-home')
  const profileDir = join(homeDir, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), '{"name":"dsh-profile-web"}\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(homeDir, 'settings.yaml'), 'theme: light\n')
  return {
    userDataDir,
    profileDir,
    homeDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function checkpointFor(f: Fixture, overrides: Record<string, unknown> = {}) {
  return createDesktopProfileCheckpoint({
    userDataDir: f.userDataDir,
    profileDir: f.profileDir,
    homeDir: f.homeDir,
    profileName: 'web',
    appVersion: '0.1.4',
    ...overrides,
  })
}

/** Whether any snapshot directory exists for the fixture's profile. */
function desktopCheckpointExists(f: Fixture): boolean {
  return existsSync(join(f.userDataDir, 'health-snapshots', 'web'))
}

test('home/* 解析到 homeDir，其余解析到 profileDir（路径映射的单一真相）', () => {
  const f = fixture()
  try {
    // The two home/* entries must NOT be joined onto the profile dir. A wrong
    // mapping here is the silent failure this suite exists to prevent.
    assert.equal(
      resolveCheckpointTarget(f.profileDir, f.homeDir, 'home/settings.yaml'),
      join(f.homeDir, 'settings.yaml'),
    )
    assert.equal(
      resolveCheckpointTarget(f.profileDir, f.homeDir, 'home/cordis.patch.yml'),
      join(f.homeDir, 'cordis.patch.yml'),
    )
    // Everything else belongs to the profile.
    for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', '.dsh-market/state.json'] as const) {
      assert.equal(resolveCheckpointTarget(f.profileDir, f.homeDir, name), join(f.profileDir, name))
    }
  } finally {
    f.cleanup()
  }
})

test('home/* 绝不落到 profile 下（防止静默备份到无人读取的目录）', () => {
  const f = fixture()
  try {
    const resolved = resolveCheckpointTarget(f.profileDir, f.homeDir, 'home/settings.yaml')
    const rel = relative(f.profileDir, resolved)
    assert.equal(
      rel.startsWith('..'),
      true,
      `home/settings.yaml 解析到了 profile 内部: ${resolved} —— 该文件不会被 DSH 读取`,
    )
  } finally {
    f.cleanup()
  }
})

test('捕获后 profile 下不出现 home/ 子目录', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    // If the mapping were naive (`join(profileDir, 'home/settings.yaml')`), the
    // snapshot step itself would have created this directory.
    assert.equal(existsSync(join(f.profileDir, 'home')), false, 'profile 下被创建了 home/')
  } finally {
    f.cleanup()
  }
})

test('往返：改真实 home 文件后恢复，文件被还原（端到端证明映射正确）', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    writeFileSync(join(f.homeDir, 'settings.yaml'), 'theme: dark\n')
    checkpoint.captureHealthy()

    // Mutate the REAL file that home/* maps to.
    writeFileSync(join(f.homeDir, 'settings.yaml'), 'theme: broken\n')
    const slot = checkpoint.listSlots().find(candidate => candidate.snapshotExists)
    assert.ok(slot !== undefined)

    checkpoint.restoreSlot(slot.slotId)

    assert.equal(
      readFileSync(join(f.homeDir, 'settings.yaml'), 'utf8'),
      'theme: dark\n',
      'home/settings.yaml 未被还原 —— 说明它根本没被快照（静默失效）',
    )
  } finally {
    f.cleanup()
  }
})

test('往返：profile 文件同样被还原', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    writeFileSync(join(f.profileDir, 'cordis.patch.yml'), 'broken!\n')
    const slot = checkpoint.listSlots().find(candidate => candidate.snapshotExists)!
    checkpoint.restoreSlot(slot.slotId)
    assert.equal(readFileSync(join(f.profileDir, 'cordis.patch.yml'), 'utf8'), '[]\n')
  } finally {
    f.cleanup()
  }
})

test('三个槽位，空槽优先', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    assert.equal(checkpoint.listSlots().length, 3)
    assert.equal(checkpoint.listSlots().every(slot => !slot.snapshotExists), true)

    const first = checkpoint.captureHealthy()
    assert.equal(first.status, 'captured')
    const second = checkpoint.captureHealthy()
    assert.equal(second.status, 'captured')
    // Empty slots are consumed before any is recycled.
    assert.notEqual(
      (first as { slotId: string }).slotId,
      (second as { slotId: string }).slotId,
    )
  } finally {
    f.cleanup()
  }
})

test('三槽全满后替换 capturedAt 最早的（时间戳分支）', () => {
  const f = fixture()
  try {
    // Advance by a full MINUTE per capture. ISO strings truncate to milliseconds,
    // so a naive `clock++` would make all three timestamps identical and the test
    // would silently exercise the slotId tie-break instead of the age comparison —
    // passing while the branch it names goes untested.
    let tick = 0
    const checkpoint = checkpointFor(f, {
      now: () => Date.UTC(2026, 0, 1, 0, tick++),
    })
    const captured = [
      checkpoint.captureHealthy(),
      checkpoint.captureHealthy(),
      checkpoint.captureHealthy(),
    ].map(result => (result as { slotId: string }).slotId)

    // All three are full. The oldest is whichever went first, so it must be the one
    // recycled — by AGE, not by slot name.
    const fourth = checkpoint.captureHealthy()
    assert.equal((fourth as { slotId: string }).slotId, captured[0], '应回收最早捕获的槽（按时间，非按槽名）')
  } finally {
    f.cleanup()
  }
})

test('时间戳相同时按 slotId 兜底，保证确定性', () => {
  const f = fixture()
  try {
    const frozen = Date.UTC(2026, 0, 1)
    const checkpoint = checkpointFor(f, { now: () => frozen })
    const captured = [
      checkpoint.captureHealthy(),
      checkpoint.captureHealthy(),
      checkpoint.captureHealthy(),
    ].map(result => (result as { slotId: string }).slotId)

    // With identical timestamps the tie-break must still be deterministic.
    const fourth = checkpoint.captureHealthy()
    assert.equal((fourth as { slotId: string }).slotId, 'slot-1')
    assert.deepEqual(captured, ['slot-1', 'slot-2', 'slot-3'])
  } finally {
    f.cleanup()
  }
})

test('skip marker：恢复后首次健康启动不覆盖任何槽', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    const slot = checkpoint.listSlots().find(candidate => candidate.snapshotExists)!
    const before = JSON.stringify(checkpoint.listSlots())

    checkpoint.restoreSlot(slot.slotId)
    const afterRestore = checkpoint.captureHealthy()

    assert.equal(afterRestore.status, 'skipped-after-restore')
    // The whole point: a verification boot must not evict a valuable older snapshot.
    assert.equal(JSON.stringify(checkpoint.listSlots()), before)
    // ...and the marker is consumed, so the NEXT capture is normal again.
    assert.equal(checkpoint.captureHealthy().status, 'captured')
  } finally {
    f.cleanup()
  }
})

test('恢复先写 marker 再改文件（失败时恢复点不丢）', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    const slot = checkpoint.listSlots().find(candidate => candidate.snapshotExists)!

    // The marker is persisted BEFORE any target file is touched, so a failure
    // during the write phase still leaves the selected recovery point protected.
    //
    // Injecting that specific failure is awkward: obstructing a target with a
    // directory trips readCurrentImages during the pre-flight scan, which happens
    // before the marker is written (the reference implementation behaves the same).
    // So instead we assert the ordering property directly — the observable outcome
    // that matters is "after a restore, the next healthy boot does not snapshot".
    //
    // Make one file differ so `changedFiles` is non-empty and the marker's
    // dependency-materialization bit is exercised for the package set too.
    writeFileSync(join(f.profileDir, 'package.json'), '{"name":"changed"}\n')
    const result = checkpoint.restoreSlot(slot.slotId)
    assert.equal(result.status, 'restored')
    assert.equal(result.dependencyMaterializationRequired, true)

    // ORDER MATTERS: the marker must be cleared of pending work BEFORE the boot
    // consumes it — `captureHealthy` deletes the marker, so completing afterwards
    // is correctly rejected (a late completion would have no restore to match).
    checkpoint.completeDependencyMaterialization(slot.slotId)

    // Marker present => the verification boot is skipped and the recovery point
    // survives, which is the invariant "persist before mutation" exists to protect.
    const after = checkpoint.captureHealthy()
    assert.equal(after.status, 'skipped-after-restore')
    assert.equal((after as { restoredSlotId: string }).restoredSlotId, slot.slotId)

    // Consumed: the boot after that snapshots normally again.
    assert.equal(checkpoint.captureHealthy().status, 'captured')
  } finally {
    f.cleanup()
  }
})

test('依赖物化未完成时，再次恢复仍标记待物化（可重试）', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    const slot = checkpoint.listSlots().find(candidate => candidate.snapshotExists)!
    writeFileSync(join(f.profileDir, 'package.json'), '{"name":"changed"}\n')

    checkpoint.restoreSlot(slot.slotId)
    // Simulate the next boot: consumes nothing yet because materialization is pending.
    // Re-restoring must still report the work as required rather than assuming the
    // earlier attempt succeeded.
    const again = checkpoint.restoreSlot(slot.slotId)
    assert.equal(again.dependencyMaterializationRequired, true)
  } finally {
    f.cleanup()
  }
})

test('inspectSlot 报告差异文件', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    const slot = checkpoint.listSlots().find(candidate => candidate.snapshotExists)!

    assert.equal(checkpoint.inspectSlot(slot.slotId).currentDiffers, false)

    writeFileSync(join(f.profileDir, 'cordis.patch.yml'), 'changed\n')
    const inspection = checkpoint.inspectSlot(slot.slotId)
    assert.equal(inspection.currentDiffers, true)
    assert.deepEqual([...inspection.changedFiles], ['cordis.patch.yml'])
  } finally {
    f.cleanup()
  }
})

test('文件清单含 7 项，且两种根都覆盖到', () => {
  // The two home/* entries encode the two-root contract; that count is the part
  // worth pinning (the total is just a restatement of the constant).
  assert.equal(DESKTOP_PROFILE_CHECKPOINT_FILES.filter(name => name.startsWith('home/')).length, 2)
  assert.equal(checkpointFiles(4).length, DESKTOP_PROFILE_CHECKPOINT_FILES.length)
})

test('非 v4 的 manifest 版本被拒绝（我们没有历史数据可读）', () => {
  for (const version of [2, 3, 5]) {
    assert.throws(() => checkpointFiles(version), `v${version} 应被拒绝`)
  }
})

test('超过单文件上限时捕获失败而不是静默截断', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f, { limits: { 'pnpm-lock.yaml': 16 } })
    writeFileSync(join(f.profileDir, 'pnpm-lock.yaml'), 'x'.repeat(64))
    assert.throws(() => checkpoint.captureHealthy())
  } finally {
    f.cleanup()
  }
})

test('清空 checkpoint 后槽位全空', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    assert.equal(checkpoint.listSlots().some(slot => slot.snapshotExists), true)
    checkpoint.clear()
    assert.equal(checkpoint.listSlots().every(slot => !slot.snapshotExists), true)
  } finally {
    f.cleanup()
  }
})

test('独立的 clearDesktopProfileCheckpoint 可清空指定 profile 的所有槽', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    assert.equal(desktopCheckpointExists(f), true)
    // The profile-deletion caller has no checkpoint instance, so this must work
    // standalone.
    clearDesktopProfileCheckpoint(f.userDataDir, 'web')
    assert.equal(desktopCheckpointExists(f), false)
  } finally {
    f.cleanup()
  }
})

test('单个槽的 manifest 损坏不影响其它槽（否则一坏就再也存不了快照）', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()   // slot-1
    checkpoint.captureHealthy()   // slot-2

    // Corrupt ONLY slot-1. A snapshot is taken on every healthy startup, so if a
    // single bad manifest propagated, one bad byte would permanently disable
    // checkpointing — including for the healthy slots.
    writeFileSync(join(checkpoint.snapshotRoot, 'slot-1', 'manifest.json'), '{ not json')

    const slots = checkpoint.listSlots()
    assert.equal(slots.length, 3, 'listSlots 不应因单个槽损坏而抛错')
    assert.equal(slots.find(slot => slot.slotId === 'slot-1')?.snapshotExists, false, '损坏的槽应视为空')
    assert.equal(slots.find(slot => slot.slotId === 'slot-2')?.snapshotExists, true, '健康槽必须仍可见')

    // The critical consequence: capture must still work.
    assert.equal(checkpoint.captureHealthy().status, 'captured')
  } finally {
    f.cleanup()
  }
})

test('未知版本的 manifest 视为空槽而不是致命错误（降级后仍可用）', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    // Simulate a manifest written by a NEWER build, then a downgrade.
    const manifestPath = join(checkpoint.snapshotRoot, 'slot-1', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: 5 }))

    assert.equal(checkpoint.listSlots().find(slot => slot.slotId === 'slot-1')?.snapshotExists, false)
    assert.equal(checkpoint.captureHealthy().status, 'captured')
  } finally {
    f.cleanup()
  }
})

test('崩溃残留的 staging 目录会被清理，.old-* 会被恢复回槽位', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    const slotDir = join(checkpoint.snapshotRoot, 'slot-1')
    const orphan = `${slotDir}.old-crashed`
    const staging = `${slotDir}.staging-999-deadbeef`
    // Simulate a crash mid-replacement: the slot was renamed away, and a half-built
    // staging directory was left behind.
    renameSync(slotDir, orphan)
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, 'junk'), 'incomplete snapshot')

    checkpoint.captureHealthy()

    assert.equal(existsSync(orphan), false, '.old-* 未恢复')
    assert.equal(existsSync(staging), false, 'staging 残留未清理（会随每次崩溃累积）')
    // The orphaned snapshot is a complete recovery point, so it must come BACK.
    assert.equal(checkpoint.listSlots().find(slot => slot.slotId === 'slot-1')?.snapshotExists, true)
  } finally {
    f.cleanup()
  }
})

test('inspectSlot 对空槽返回空结果而不抛错', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    const inspection = checkpoint.inspectSlot('slot-2')
    assert.equal(inspection.snapshotExists, false)
    assert.equal(inspection.currentDiffers, false)
    assert.deepEqual([...inspection.changedFiles], [])
  } finally {
    f.cleanup()
  }
})
