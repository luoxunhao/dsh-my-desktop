import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  DataDirectoryError,
  dataDirectoryStatePath,
  readDataDirectoryState,
  resolveDataDirectory,
  selectDataDirectory,
  type DataDirectoryErrorCode,
} from '../src/recovery/data-directory.js'

/**
 * The Desktop-owned DSH home selection.
 *
 * WHY THE PRIORITY DIRECTION IS THE MOST IMPORTANT THING HERE
 * -----------------------------------------------------------
 * A state file written by the user WINS over `DSH_HOME`. That direction is
 * deliberate: choosing a directory in the recovery page is an explicit act of
 * intent, and letting an environment variable silently override it would leave the
 * user changing a setting that appears to do nothing. The tests below pin the
 * direction, not just the existence of a priority list.
 *
 * The other cluster of tests covers the safety refusals: a filesystem root, a
 * symlink, a path that does not exist, and a path that would contain the app's own
 * state directory.
 */

function fixture(): { root: string, userDataDir: string, defaultHome: string, cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-data-dir-'))
  const userDataDir = join(root, 'user-data')
  const defaultHome = join(root, 'default-home')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(defaultHome, { recursive: true })
  return { root, userDataDir, defaultHome, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** Capture the thrown error's code, failing loudly if nothing was thrown. */
function codeOf(action: () => unknown): DataDirectoryErrorCode {
  try {
    action()
  } catch (error) {
    assert.ok(error instanceof DataDirectoryError, `应抛 DataDirectoryError，实际 ${String(error)}`)
    return error.code
  }
  throw new Error('预期抛错但没有')
}

test('状态文件形状：activeHome / previousHome / generation，只含已知键', () => {
  const f = fixture()
  try {
    const target = join(f.root, 'chosen-home')
    mkdirSync(target)
    selectDataDirectory(f.userDataDir, target, { defaultHome: f.defaultHome })

    const raw = JSON.parse(readFileSync(dataDirectoryStatePath(f.userDataDir), 'utf8')) as Record<string, unknown>
    assert.equal(raw.version, 1)
    assert.equal(raw.activeHome, resolve(target))
    assert.equal(raw.previousHome, null, '首次切换没有前一个目录')
    assert.equal(raw.generation, 1)
    assert.equal(typeof raw.updatedAt, 'string')
    // A state file with unexpected keys would mean a schema drift went unnoticed.
    assert.deepEqual(Object.keys(raw).sort(), ['activeHome', 'generation', 'previousHome', 'updatedAt', 'version'])
  } finally {
    f.cleanup()
  }
})

test('无状态文件时用 fallback，来源如实报告', () => {
  const f = fixture()
  try {
    const asDefault = resolveDataDirectory(f.userDataDir, { fallbackHome: f.defaultHome, fallbackSource: 'default' })
    assert.equal(asDefault.homeDir, resolve(f.defaultHome))
    assert.equal(asDefault.source, 'default')
    assert.equal(asDefault.generation, 0)

    const asEnvironment = resolveDataDirectory(f.userDataDir, { fallbackHome: f.defaultHome, fallbackSource: 'environment' })
    assert.equal(asEnvironment.source, 'environment', 'DSH_HOME 已设时应报告为 environment')
  } finally {
    f.cleanup()
  }
})

test('状态文件优先于环境变量（用户显式选择不被静默覆盖）', () => {
  const f = fixture()
  try {
    const chosen = join(f.root, 'chosen-home')
    mkdirSync(chosen)
    selectDataDirectory(f.userDataDir, chosen, { defaultHome: f.defaultHome })

    // Even with DSH_HOME set, the user's explicit choice must win — otherwise the
    // recovery-page setting would appear to do nothing.
    const resolved = resolveDataDirectory(f.userDataDir, {
      fallbackHome: join(f.root, 'from-environment'),
      fallbackSource: 'environment',
    })
    assert.equal(resolved.homeDir, resolve(chosen))
    assert.equal(resolved.source, 'desktop')
  } finally {
    f.cleanup()
  }
})

test('切换到新目录会记录 previousHome 并递增 generation', () => {
  const f = fixture()
  try {
    const first = join(f.root, 'home-a')
    const second = join(f.root, 'home-b')
    mkdirSync(first)
    mkdirSync(second)

    selectDataDirectory(f.userDataDir, first, { defaultHome: f.defaultHome })
    selectDataDirectory(f.userDataDir, second, { defaultHome: f.defaultHome })

    const state = readDataDirectoryState(f.userDataDir)
    assert.equal(state?.activeHome, resolve(second))
    assert.equal(state?.previousHome, resolve(first), '应记住上一个目录，便于回退')
    assert.equal(state?.generation, 2)
  } finally {
    f.cleanup()
  }
})

test('拒绝不存在的目标（不静默接受空路径）', () => {
  const f = fixture()
  try {
    const missing = join(f.root, 'does-not-exist')
    assert.equal(
      codeOf(() => selectDataDirectory(f.userDataDir, missing, { defaultHome: f.defaultHome })),
      'target-unavailable',
    )
    // Nothing may be written when the target is rejected.
    assert.equal(existsSync(dataDirectoryStatePath(f.userDataDir)), false)
  } finally {
    f.cleanup()
  }
})

test('拒绝相对路径', () => {
  const f = fixture()
  try {
    assert.equal(
      codeOf(() => selectDataDirectory(f.userDataDir, 'relative/path', { defaultHome: f.defaultHome })),
      'invalid-path',
    )
  } finally {
    f.cleanup()
  }
})

test('拒绝符号链接目标（否则数据会写到链接指向的意外位置）', () => {
  // PLATFORM NOTE (same finding as safe-mode): on Windows a `junction` reports
  // isSymbolicLink() === true but isDirectory() === false, so it would be rejected
  // by the "must be a real directory" check even without the explicit symlink
  // branch — and real directory symlinks cannot be created without elevation
  // (EPERM). The explicit check is therefore load-bearing on POSIX, where a
  // directory symlink reports isDirectory() === true.
  //
  // We assert the OUTCOME (a symlink target is refused) rather than pretending the
  // Windows run exercises that specific branch, so removing the branch on POSIX
  // cannot happen while this test stays green.
  const f = fixture()
  const victim = mkdtempSync(join(tmpdir(), 'dsh-victim-'))
  try {
    const link = join(f.root, 'link-to-elsewhere')
    symlinkSync(victim, link, 'junction')
    assert.equal(lstatSync(link).isSymbolicLink(), true, '前置条件：确实创建了符号链接')

    assert.equal(
      codeOf(() => selectDataDirectory(f.userDataDir, link, { defaultHome: f.defaultHome })),
      'target-invalid',
    )
    assert.equal(existsSync(dataDirectoryStatePath(f.userDataDir)), false)
  } finally {
    f.cleanup()
    rmSync(victim, { recursive: true, force: true })
  }
})

test('isRealDirectory 拒绝符号链接（平台语义说明）', () => {
  // Documents WHY the explicit `!isSymbolicLink()` exists: it is the only thing
  // stopping a POSIX directory symlink from being accepted as a real directory.
  // On Windows the junction case is already caught by isDirectory() === false, so
  // this test records the platform fact instead of claiming coverage it lacks.
  const root = mkdtempSync(join(tmpdir(), 'dsh-symlink-probe-'))
  const victim = mkdtempSync(join(tmpdir(), 'dsh-victim-'))
  try {
    const link = join(root, 'link')
    symlinkSync(victim, link, 'junction')
    const stat = lstatSync(link)
    assert.equal(stat.isSymbolicLink(), true)
    if (process.platform === 'win32') {
      // The Windows semantics that make the explicit branch redundant here.
      assert.equal(stat.isDirectory(), false)
    } else {
      // On POSIX the branch is the only protection.
      assert.equal(stat.isDirectory(), true)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(victim, { recursive: true, force: true })
  }
})

test('拒绝文件系统根', () => {
  const f = fixture()
  try {
    const root = resolve('/')
    assert.equal(
      codeOf(() => selectDataDirectory(f.userDataDir, root, { defaultHome: f.defaultHome })),
      'target-invalid',
    )
  } finally {
    f.cleanup()
  }
})

test('拒绝会包含应用自身状态目录的目标（否则应用会把自己删掉）', () => {
  const f = fixture()
  try {
    // userDataDir lives inside `root`, so choosing `root` as the data home would
    // put the app's own state inside the tree it manages.
    assert.equal(
      codeOf(() => selectDataDirectory(f.userDataDir, f.root, { defaultHome: f.defaultHome })),
      'path-conflict',
    )
    assert.equal(existsSync(dataDirectoryStatePath(f.userDataDir)), false)
  } finally {
    f.cleanup()
  }
})

test('状态文件损坏时回退到 fallback 而不是崩溃', () => {
  const f = fixture()
  try {
    mkdirSync(join(f.userDataDir, 'data-directory'), { recursive: true })
    writeFileSync(dataDirectoryStatePath(f.userDataDir), '{ not json')

    const resolved = resolveDataDirectory(f.userDataDir, { fallbackHome: f.defaultHome, fallbackSource: 'default' })
    assert.equal(resolved.homeDir, resolve(f.defaultHome), '损坏状态应回退，保证应用仍能启动')
    assert.equal(readDataDirectoryState(f.userDataDir), undefined)
  } finally {
    f.cleanup()
  }
})

test('状态文件指向已消失的目录时拒绝（而不是返回一个不存在的 home）', () => {
  const f = fixture()
  try {
    const chosen = join(f.root, 'chosen-home')
    mkdirSync(chosen)
    selectDataDirectory(f.userDataDir, chosen, { defaultHome: f.defaultHome })
    rmSync(chosen, { recursive: true, force: true })

    // Silently returning the stale path would make the app fail later with a
    // confusing error far from the cause.
    assert.equal(
      codeOf(() => resolveDataDirectory(f.userDataDir, { fallbackHome: f.defaultHome, fallbackSource: 'default' })),
      'source-unavailable',
    )
  } finally {
    f.cleanup()
  }
})

test('恢复默认：清除状态文件后回到 fallback', () => {
  const f = fixture()
  try {
    const chosen = join(f.root, 'chosen-home')
    mkdirSync(chosen)
    selectDataDirectory(f.userDataDir, chosen, { defaultHome: f.defaultHome })
    assert.equal(resolveDataDirectory(f.userDataDir, { fallbackHome: f.defaultHome, fallbackSource: 'default' }).source, 'desktop')

    selectDataDirectory(f.userDataDir, null, { defaultHome: f.defaultHome })
    const reset = resolveDataDirectory(f.userDataDir, { fallbackHome: f.defaultHome, fallbackSource: 'default' })
    assert.equal(reset.source, 'default')
    assert.equal(reset.homeDir, resolve(f.defaultHome))
  } finally {
    f.cleanup()
  }
})

test('不迁移数据：切换只改指向，不动目录内容', () => {
  const f = fixture()
  try {
    const source = join(f.root, 'home-a')
    const target = join(f.root, 'home-b')
    mkdirSync(source)
    mkdirSync(target)
    writeFileSync(join(source, 'settings.yaml'), 'theme: dark\n')

    selectDataDirectory(f.userDataDir, target, { defaultHome: f.defaultHome })

    // The whole feature is "point somewhere else", never "copy". Copying could
    // destroy the destination and would take minutes on a large home.
    assert.equal(existsSync(join(target, 'settings.yaml')), false, '不应把数据搬过去')
    assert.equal(existsSync(join(source, 'settings.yaml')), true, '不应移动或删除源数据')
  } finally {
    f.cleanup()
  }
})
