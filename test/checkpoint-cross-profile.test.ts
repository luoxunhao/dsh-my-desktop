import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDesktopProfileCheckpoint } from '../src/recovery/profile-checkpoint.js'
import { projectCheckpointSlots } from '../src/recovery/renderer-views.js'

/**
 * Slots are NOT welded to a profile.
 *
 * THE MODEL (taken from dsh-desktop's profile-checkpoint.ts)
 * ---------------------------------------------------------
 * Slots are stored per profile (`userData/health-snapshots/<profile>/slot-N`) and
 * every manifest records the `profileName` it was captured from. A slot is a full
 * configuration image, so restoring one INTO a different profile is a supported
 * operation — that is what "roll back to a different profile" means.
 *
 * WHAT WAS BROKEN
 * ---------------
 *  1. The projection DROPPED `profileName`, so the page could not tell two
 *     profiles' slots apart — which is exactly why both profiles appeared to show
 *     "the same slots".
 *  2. `restoreSlot` could only write into its own profile, so a cross-profile
 *     restore was impossible even once the page could name the source.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cross-profile-'))
  const homeDir = join(root, 'dsh-home')
  const webDir = join(homeDir, 'profiles', 'web')
  const desktopDir = join(homeDir, 'profiles', 'desktop')
  const userDataDir = join(root, 'user-data')
  mkdirSync(webDir, { recursive: true })
  mkdirSync(desktopDir, { recursive: true })
  mkdirSync(userDataDir, { recursive: true })
  const checkpointFor = (profileDir: string, profileName: string) => createDesktopProfileCheckpoint({
    userDataDir,
    profileDir,
    homeDir,
    profileName,
    appVersion: '0.2.1',
  })
  return { root, homeDir, webDir, desktopDir, userDataDir, checkpointFor, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('槽位带着自己的来源 profile（否则两个 profile 的槽无法区分）', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.desktopDir, 'package.json'), '{"name":"desktop-manifest"}\n')
    const desktop = f.checkpointFor(f.desktopDir, 'desktop')
    desktop.captureHealthy()

    const slots = projectCheckpointSlots(desktop.listSlots(), 'desktop')
    const captured = slots.find(slot => slot.status === 'available')
    assert.ok(captured !== undefined)
    assert.equal(captured.profileName, 'desktop', '槽必须报告它来自哪个 profile')

    // 空槽也要带来源，页面才能把它们归到正确的分组下。
    const web = f.checkpointFor(f.webDir, 'web')
    const webSlots = projectCheckpointSlots(web.listSlots(), 'web')
    assert.equal(webSlots.every(slot => slot.profileName === 'web'), true)
  } finally {
    f.cleanup()
  }
})

test('跨 profile 回滚：desktop 的快照可以写进 web', () => {
  const f = fixture()
  try {
    // desktop 有一份"装了插件"的配置。
    const desktopManifest = '{"name":"desktop","dsh":{"profile":{"bundles":["a","b","c"]}}}\n'
    writeFileSync(join(f.desktopDir, 'package.json'), desktopManifest)
    writeFileSync(join(f.homeDir, 'settings.yaml'), 'theme: dark\n')
    const desktop = f.checkpointFor(f.desktopDir, 'desktop')
    const captured = desktop.captureHealthy()
    assert.equal(captured.status, 'captured')

    // web 是干净的。
    writeFileSync(join(f.webDir, 'package.json'), '{"name":"web-clean"}\n')

    // 把 desktop 的槽恢复进 web —— 读来自 desktop，写进 web。
    const result = desktop.restoreSlot('slot-1', { profileDir: f.webDir, homeDir: f.homeDir })
    assert.equal(result.status, 'restored')
    assert.equal(
      readFileSync(join(f.webDir, 'package.json'), 'utf8'),
      desktopManifest,
      'web 的 manifest 应被 desktop 快照的内容替换',
    )
    // 源 profile 不受影响。
    assert.equal(readFileSync(join(f.desktopDir, 'package.json'), 'utf8'), desktopManifest)
  } finally {
    f.cleanup()
  }
})

test('跨 profile 回滚后，changedFiles 按目标 profile 计算而非源', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.desktopDir, 'package.json'), '{"name":"desktop"}\n')
    const desktop = f.checkpointFor(f.desktopDir, 'desktop')
    desktop.captureHealthy()

    // 目标与快照不同 → 必须报告有变化；若错误地拿源 profile 比较会得到"无变化"。
    writeFileSync(join(f.webDir, 'package.json'), '{"name":"web-different"}\n')
    const result = desktop.restoreSlot('slot-1', { profileDir: f.webDir, homeDir: f.homeDir })
    assert.equal(
      result.changedFiles.includes('package.json'),
      true,
      'changedFiles 必须反映目标 profile 的差异',
    )
  } finally {
    f.cleanup()
  }
})

test('空槽跨 profile 回滚会抛错（不能把"空"当成一次恢复）', () => {
  const f = fixture()
  try {
    const desktop = f.checkpointFor(f.desktopDir, 'desktop')
    assert.throws(
      () => desktop.restoreSlot('slot-2', { profileDir: f.webDir, homeDir: f.homeDir }),
      /empty/i,
    )
  } finally {
    f.cleanup()
  }
})
