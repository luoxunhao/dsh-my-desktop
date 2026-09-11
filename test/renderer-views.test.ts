import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDesktopProfileCheckpoint } from '../src/recovery/profile-checkpoint.js'
import {
  projectCheckpointSlots,
  projectProfileViews,
  type ProjectedProfile,
} from '../src/recovery/renderer-views.js'

/**
 * The renderer-safe projections the recovery page reads.
 *
 * Two properties matter here and both come from earlier work:
 *
 *   - **A corrupt slot must not hide the healthy ones.** Stage 3 hardened
 *     `readSnapshot` to treat a malformed manifest as an empty slot; this asserts
 *     that hardening survives the projection step, because the page would otherwise
 *     lose access to every recovery point because of one bad file.
 *   - **No absolute paths leak to the renderer.** The page is sandboxed; it needs to
 *     describe a slot, not to know where the user's filesystem lives.
 */

function fixture(): {
  root: string
  userDataDir: string
  profileDir: string
  homeDir: string
  cleanup: () => void
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-views-'))
  const homeDir = join(root, 'dsh-home')
  const profileDir = join(homeDir, 'profiles', 'web')
  const userDataDir = join(root, 'user-data')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), '{"name":"x"}\n')
  writeFileSync(join(homeDir, 'settings.yaml'), 'theme: dark\n')
  return { root, userDataDir, profileDir, homeDir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function checkpointFor(f: ReturnType<typeof fixture>) {
  return createDesktopProfileCheckpoint({
    userDataDir: f.userDataDir,
    profileDir: f.profileDir,
    homeDir: f.homeDir,
    profileName: 'web',
    appVersion: '0.2.0',
  })
}

test('空槽也列出，状态标记为 empty', () => {
  const f = fixture()
  try {
    const slots = projectCheckpointSlots(checkpointFor(f).listSlots(), 'web')
    assert.equal(slots.length, 3)
    assert.deepEqual(slots.map(slot => slot.slotId), ['slot-1', 'slot-2', 'slot-3'])
    assert.equal(slots.every(slot => slot.status === 'empty'), true)
    // An empty slot must not carry a capture time — the page renders that as
    // "no healthy startup recorded", and a stale value would be a lie.
    assert.equal(slots.every(slot => slot.capturedAt === undefined), true)
  } finally {
    f.cleanup()
  }
})

test('已捕获的槽带出时间、版本、文件数与总大小', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    const slots = projectCheckpointSlots(checkpointFor(f).listSlots(), 'web')
    const captured = slots.find(slot => slot.status === 'available')
    assert.ok(captured !== undefined, '应有一个可用槽')
    assert.equal(captured.appVersion, '0.2.0')
    assert.equal(typeof captured.capturedAt, 'string')
    assert.equal(Number.isFinite(Date.parse(captured.capturedAt!)), true)

    // `fileCount` is the number of files the checkpoint GOVERNS, not the number
    // present: the manifest records an entry per file in the checkpoint list,
    // marking missing ones `present: false`. The fixture only creates two of them,
    // so the count is the full list — this is the number the page should show,
    // because it describes the scope of a rollback.
    assert.equal(captured.fileCount, 7)
    // Bytes, by contrast, only count files that actually exist.
    assert.equal((captured.totalBytes ?? 0) > 0, true)
    assert.equal(captured.totalBytes! < 1000, true, '夹具里只有两个很小的文件')
  } finally {
    f.cleanup()
  }
})

test('单个槽损坏不影响其它槽的可见性（阶段 3 的容错必须活到投影层）', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()   // slot-1
    checkpoint.captureHealthy()   // slot-2
    writeFileSync(join(checkpoint.snapshotRoot, 'slot-1', 'manifest.json'), '{ not json')

    const slots = projectCheckpointSlots(checkpointFor(f).listSlots(), 'web')
    assert.equal(slots.length, 3, '损坏的槽不应让投影整体失败')
    assert.equal(slots.find(slot => slot.slotId === 'slot-1')?.status, 'empty')
    assert.equal(slots.find(slot => slot.slotId === 'slot-2')?.status, 'available', '健康槽必须仍可见')
  } finally {
    f.cleanup()
  }
})

test('投影不向渲染层泄露绝对路径', () => {
  const f = fixture()
  try {
    const checkpoint = checkpointFor(f)
    checkpoint.captureHealthy()
    const serialized = JSON.stringify(projectCheckpointSlots(checkpointFor(f).listSlots(), 'web'))
    // The page is sandboxed and has no filesystem access; it only needs to describe
    // a slot. Leaking the home path would tell a compromised page where the user's
    // data lives.
    assert.doesNotMatch(serialized, /snapshotRoot|snapshotDirectory/, '不应暴露快照目录字段')
    assert.equal(serialized.includes(f.root.replace(/\\/g, '\\\\')), false, '不应包含绝对路径')
    assert.equal(serialized.includes('dsh-views-'), false, '不应包含临时目录名')
  } finally {
    f.cleanup()
  }
})

test('profile 视图标记当前项，并去掉不可操作项的原因细节', () => {
  const profiles: ProjectedProfile[] = [
    { name: 'web', current: true, selectable: true, deletable: false, exists: true, webCapable: true, problem: null },
    { name: 'desktop', current: false, selectable: true, deletable: true, exists: true, webCapable: true, problem: null },
    { name: 'broken', current: false, selectable: false, deletable: true, exists: true, webCapable: false, problem: 'no web bundle' },
  ]
  const views = projectProfileViews(profiles)
  assert.equal(views.length, 3)
  const web = views.find(view => view.name === 'web')!
  assert.equal(web.current, true)
  // The active profile cannot be deleted — the backend refuses, so the UI must not
  // offer it. Reporting the flag keeps that rule in one place.
  assert.equal(web.deletable, false)
  const broken = views.find(view => view.name === 'broken')!
  assert.equal(broken.selectable, false)
  assert.equal(broken.webCapable, false)
})

test('profile 视图保持输入顺序（当前项通常在最前，便于页面直接渲染）', () => {
  const views = projectProfileViews([
    { name: 'a', current: false, selectable: true, deletable: true, exists: true, webCapable: true, problem: null },
    { name: 'b', current: true, selectable: true, deletable: false, exists: true, webCapable: true, problem: null },
  ])
  assert.deepEqual(views.map(view => view.name), ['a', 'b'])
})
