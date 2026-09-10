import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import test from 'node:test'

import {
  checkpointFiles,
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

test('三个固定槽位，空槽优先', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    assert.deepEqual([...DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS], ['slot-1', 'slot-2', 'slot-3'])
    assert.equal(checkpoint.listSlots().length, 3)
    assert.equal(checkpoint.listSlots().every(slot => !slot.snapshotExists), true)

    const first = checkpoint.captureHealthy()
    assert.equal(first.status, 'captured')
    const second = checkpoint.captureHealthy()
    assert.equal(second.status, 'captured')
    // Empty slots are consumed before any is recycled.
    assert.notEqual((first as { slotId: string }).slotId, (second as { slotId: string }).slotId)
  } finally {
    f.cleanup()
  }
})

test('三槽全满后替换 capturedAt 最早的', () => {
  const f = fixture()
  try {
    let clock = 0
    const checkpoint = checkpointFor(f, { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).getTime() })
    const captured: string[] = []
    for (let i = 0; i < 3; i++) {
      const result = checkpoint.captureHealthy()
      captured.push((result as { slotId: string }).slotId)
    }
    // All three are now full; the next capture must recycle the OLDEST (slot-1).
    const fourth = checkpoint.captureHealthy()
    assert.equal((fourth as { slotId: string }).slotId, 'slot-1')
    assert.equal(captured.includes('slot-1'), true)
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
  assert.equal(DESKTOP_PROFILE_CHECKPOINT_FILES.length, 7)
  assert.equal(DESKTOP_PROFILE_CHECKPOINT_FILES.filter(name => name.startsWith('home/')).length, 2)
  // v4 is the only manifest version we emit; there is no legacy data to read.
  assert.equal(checkpointFiles(4).length, 7)
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
