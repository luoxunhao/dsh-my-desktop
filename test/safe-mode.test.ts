import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'

import {
  cleanupDesktopSafeModeEnvironment,
  desktopSafeModePaths,
  desktopSafeModeProfileDir,
  ensureDesktopSafeModeEnvironment,
  prepareDesktopSafeModeEnvironment,
  resetDesktopSafeModeEnvironment,
  DESKTOP_SAFE_MODE_PROFILE_NAME,
} from '../src/recovery/safe-mode.js'
import { profileDirFor, readActiveProfile, resolveProfileRoots } from '../src/profiles/profiles.js'

/**
 * Safe Mode is a DISPOSABLE, ISOLATED DSH environment.
 *
 * The tests below care most about two things that are easy to get wrong and
 * catastrophic when wrong:
 *
 *   1. A symlinked root must never be adopted — adopting it would make cleanup
 *      delete whatever it points at (potentially the user's real ~/.dsh).
 *   2. Cleanup must unlink symlinks rather than recurse through them, for the
 *      same reason.
 *
 * Everything else (marker validation, retry, rollback) is secondary to those.
 */

function tempUserData(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-safe-mode-'))
}

/**
 * True containment, unlike a bare `startsWith`, which would also accept a sibling
 * such as `<root>-evil/...`. Both sides are resolved first so the comparison is on
 * real paths.
 */
function isInside(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Restore an env var to its prior value (or delete it if it was unset). */
function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name]
  else process.env[name] = previous
}

/** Write a well-formed marker + directories, i.e. an adoptable environment. */
function seedHealthyEnvironment(userDataDir: string, createdAt = '2026-01-01T00:00:00.000Z'): void {
  const paths = desktopSafeModePaths(userDataDir)
  mkdirSync(paths.homeDir, { recursive: true })
  mkdirSync(paths.userDataDir, { recursive: true })
  writeFileSync(join(paths.rootDir, 'environment.json'), `${JSON.stringify({ version: 1, createdAt })}\n`)
}

test('路径解析是纯函数，不触碰文件系统', () => {
  const userDataDir = tempUserData()
  try {
    const paths = desktopSafeModePaths(userDataDir)
    assert.equal(paths.rootDir, join(userDataDir, 'safe-mode'))
    assert.equal(paths.homeDir, join(paths.rootDir, 'dsh-home'))
    assert.equal(paths.userDataDir, join(paths.rootDir, 'desktop-state'))
    // Resolving must not create anything.
    assert.equal(existsSync(paths.rootDir), false)
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('非绝对路径 / 空串 / 含 NUL 一律拒绝', () => {
  for (const bad of ['', 'relative/path', `C:\\ok\0bad`, 'safe\u0000mode']) {
    assert.throws(() => desktopSafeModePaths(bad), TypeError, `应拒绝: ${JSON.stringify(bad)}`)
  }
})

test('ensure 在空目录上重建', () => {
  const userDataDir = tempUserData()
  try {
    const paths = ensureDesktopSafeModeEnvironment(userDataDir)
    assert.equal(existsSync(join(paths.rootDir, 'environment.json')), true)
    assert.equal(lstatSync(paths.homeDir).isDirectory(), true)
    assert.equal(lstatSync(paths.userDataDir).isDirectory(), true)
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('ensure 在完好环境上复用（不重建、createdAt 不变）', () => {
  const userDataDir = tempUserData()
  try {
    const stamp = '2020-05-05T05:05:05.000Z'
    seedHealthyEnvironment(userDataDir, stamp)
    const before = readFileSync(join(desktopSafeModePaths(userDataDir).rootDir, 'environment.json'), 'utf8')
    ensureDesktopSafeModeEnvironment(userDataDir)
    const after = readFileSync(join(desktopSafeModePaths(userDataDir).rootDir, 'environment.json'), 'utf8')
    // Reuse means the marker survives untouched — a rebuilt one would carry a new time.
    assert.equal(after, before)
    assert.match(after, new RegExp(stamp.replace(/[.]/g, '\\.')))
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('marker 损坏（版本错 / JSON 坏 / 超限）一律重建', () => {
  for (const bad of [
    '{"version":2,"createdAt":"2026-01-01T00:00:00.000Z"}\n',   // wrong version
    '{not json',                                                  // unparsable
    '{"version":1}\n',                                            // missing createdAt
    '{"version":1,"createdAt":"nonsense"}\n',                     // invalid date
    'x'.repeat(5 * 1024),                                         // exceeds 4 KB cap
  ]) {
    const userDataDir = tempUserData()
    try {
      seedHealthyEnvironment(userDataDir)
      writeFileSync(join(desktopSafeModePaths(userDataDir).rootDir, 'environment.json'), bad)
      ensureDesktopSafeModeEnvironment(userDataDir)
      const after = JSON.parse(readFileSync(join(desktopSafeModePaths(userDataDir).rootDir, 'environment.json'), 'utf8')) as { version: number }
      assert.equal(after.version, 1, `应被重建: ${bad.slice(0, 40)}`)
    } finally {
      rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})

test('符号链接的 rootDir 绝不采纳（安全边界：否则清理会删掉链接目标）', () => {
  const userDataDir = tempUserData()
  const victim = mkdtempSync(join(tmpdir(), 'dsh-victim-'))
  try {
    writeFileSync(join(victim, 'precious.txt'), 'do not delete')
    const paths = desktopSafeModePaths(userDataDir)
    mkdirSync(userDataDir, { recursive: true })

    // The link target is a COMPLETE, otherwise-adoptable environment: marker with
    // the right version, plus both child directories. Without this the rebuild
    // would be triggered by the missing marker instead, and the symlink path would
    // go untested.
    mkdirSync(join(victim, 'dsh-home'), { recursive: true })
    mkdirSync(join(victim, 'desktop-state'), { recursive: true })
    writeFileSync(join(victim, 'environment.json'), `${JSON.stringify({ version: 1, createdAt: '2026-01-01T00:00:00.000Z' })}\n`)
    symlinkSync(victim, paths.rootDir, 'junction')

    const result = ensureDesktopSafeModeEnvironment(userDataDir)

    // The OUTCOME this guarantees. Two independent mechanisms provide it — the
    // `!isSymbolicLink()` check in isRealDirectory, and removeSafeModeEntry
    // unlinking rather than recursing — so removing either one alone still passes.
    // That is deliberate defence in depth; the cleanup test below isolates the
    // second mechanism, and this one pins the observable contract.
    assert.equal(existsSync(join(victim, 'precious.txt')), true, '链接目标被删了 —— 安全边界失效')
    assert.equal(lstatSync(paths.rootDir).isSymbolicLink(), false, '符号链接的 root 被采纳了')
    assert.equal(lstatSync(result.homeDir).isSymbolicLink(), false)
    assert.equal(lstatSync(result.homeDir).isDirectory(), true)
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(victim, { recursive: true, force: true })
  }
})

test('清理时符号链接只 unlink、不递归进目标（安全边界）', () => {
  const userDataDir = tempUserData()
  const victim = mkdtempSync(join(tmpdir(), 'dsh-victim-'))
  try {
    writeFileSync(join(victim, 'precious.txt'), 'do not delete')
    const paths = desktopSafeModePaths(userDataDir)
    mkdirSync(paths.rootDir, { recursive: true })
    // A symlink INSIDE the disposable tree pointing outside it.
    symlinkSync(victim, join(paths.rootDir, 'escape'), 'junction')

    cleanupDesktopSafeModeEnvironment(userDataDir)

    assert.equal(existsSync(join(victim, 'precious.txt')), true, '清理穿透了符号链接 —— 安全边界失效')
    assert.equal(existsSync(paths.rootDir), false)
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(victim, { recursive: true, force: true })
  }
})

// A NOTE ON PLATFORM SEMANTICS, deliberately NOT a test.
//
// `removeSafeModeEntry` branches on `stat.isSymbolicLink() || !stat.isDirectory()`
// before recursing. On Windows that explicit symlink check is UNREACHABLE as a
// distinct behaviour: a `junction` reports isSymbolicLink() === true but
// isDirectory() === false, so it would be unlinked anyway; and real directory
// symlinks cannot be created without elevation (EPERM).
//
// The check IS load-bearing on POSIX, where a directory symlink reports
// isDirectory() === true and would otherwise be recursed into — deleting the
// link target. Because no Windows test can falsify its removal, a test here would
// be a green light for a future reader to delete it. It is documented instead,
// and the observable contract (victim survives, root removed) is pinned by the
// '清理时符号链接只 unlink' test above.

test('cleanup 对不存在的目录返回 false 且不抛（幂等）', () => {
  const userDataDir = tempUserData()
  try {
    assert.equal(cleanupDesktopSafeModeEnvironment(userDataDir), false)
    const paths = ensureDesktopSafeModeEnvironment(userDataDir)
    assert.equal(cleanupDesktopSafeModeEnvironment(userDataDir), true)
    assert.equal(cleanupDesktopSafeModeEnvironment(userDataDir), false)
    assert.equal(existsSync(paths.rootDir), false)
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('reset 后三处目录存在', () => {
  const userDataDir = tempUserData()
  try {
    const paths = resetDesktopSafeModeEnvironment(userDataDir)
    assert.equal(lstatSync(paths.rootDir).isDirectory(), true)
    assert.equal(lstatSync(paths.homeDir).isDirectory(), true)
    assert.equal(lstatSync(paths.userDataDir).isDirectory(), true)
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('reset 可注入时钟（createdAt 来自 now()，便于测试与确定性）', () => {
  const userDataDir = tempUserData()
  try {
    const fixed = new Date('2021-03-04T05:06:07.000Z')
    const paths = resetDesktopSafeModeEnvironment(userDataDir, () => fixed)
    const marker = JSON.parse(readFileSync(join(paths.rootDir, 'environment.json'), 'utf8')) as { createdAt: string }
    assert.equal(marker.createdAt, fixed.toISOString())
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('reset 写 marker 用独占标志：已存在时不静默覆盖', () => {
  // `wx` rather than `w`: a pre-existing marker means state is unexpected. We assert
  // the observable consequence — reset builds a CLEAN environment (the old marker is
  // removed by the preceding cleanup, never overwritten in place).
  const userDataDir = tempUserData()
  try {
    const paths = resetDesktopSafeModeEnvironment(userDataDir)
    const markerPath = join(paths.rootDir, 'environment.json')
    writeFileSync(markerPath, '{"version":1,"createdAt":"1999-01-01T00:00:00.000Z"}\n')
    resetDesktopSafeModeEnvironment(userDataDir)
    const after = JSON.parse(readFileSync(markerPath, 'utf8')) as { createdAt: string }
    // The stale timestamp must be gone — proof it was replaced, not reused.
    assert.notEqual(after.createdAt, '1999-01-01T00:00:00.000Z')
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('reset 会清除 rootDir 处的同名文件（cleanup 先于 mkdir 生效）', () => {
  // Not a rollback test — a boundary test for the ORDER inside reset. A file (not a
  // directory) sitting at rootDir must be cleared by the leading cleanup, otherwise
  // the following mkdirSync would fail with EEXIST. This is what makes reset
  // idempotent against a partially-created or foreign rootDir.
  const userDataDir = tempUserData()
  try {
    const paths = desktopSafeModePaths(userDataDir)
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(paths.rootDir, 'blocker')
    resetDesktopSafeModeEnvironment(userDataDir)
    assert.equal(lstatSync(paths.rootDir).isDirectory(), true)
    assert.equal(existsSync(join(paths.rootDir, 'environment.json')), true)
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('reset 失败会回滚，不留半成品环境', () => {
  // INJECTION NOTE: `reset` runs cleanup FIRST, so no external blocker placed under
  // rootDir survives long enough to fail a later step — every attempt I made from
  // outside was erased by that cleanup. The one call inside the try block that a
  // caller controls is the injected `now()`, which is what makes this reachable.
  const userDataDir = tempUserData()
  try {
    const paths = desktopSafeModePaths(userDataDir)
    assert.throws(() => resetDesktopSafeModeEnvironment(userDataDir, () => {
      throw new Error('injected clock failure')
    }))
    // A half-built environment would be ADOPTED by the next launch, because its
    // marker and child directories would look plausible — so the failure would be
    // silent. Rollback must therefore leave nothing behind.
    assert.equal(existsSync(paths.rootDir), false, '失败后残留了半成品环境')
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('prepare 成功后环境完整，且 DSH_HOME 指向隔离 home', () => {
  // Rollback in `prepare` is not reachable through the public API (its inner reset
  // cleans first, erasing any external blocker), so this asserts the success
  // contract instead of pretending to test the failure path. The blocking property
  // it DOES pin is the one that actually bit us: DSH_HOME must end up inside the
  // isolation root, because the launcher resolves `home` from it.
  const userDataDir = tempUserData()
  const savedHome = process.env.DSH_HOME
  try {
    const paths = prepareDesktopSafeModeEnvironment(userDataDir)
    assert.equal(existsSync(paths.rootDir), true)
    assert.equal(isInside(process.env.DSH_HOME ?? '', paths.rootDir), true, 'DSH_HOME 未指向隔离 home')
  } finally {
    restoreEnv('DSH_HOME', savedHome)
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('reset 会丢弃旧环境（不是原地复用）', () => {
  const userDataDir = tempUserData()
  try {
    const paths = resetDesktopSafeModeEnvironment(userDataDir)
    writeFileSync(join(paths.homeDir, 'stale.txt'), 'from the previous Safe Mode run')
    resetDesktopSafeModeEnvironment(userDataDir)
    // A reset must produce a clean environment; leftovers would leak between runs.
    assert.equal(existsSync(join(paths.homeDir, 'stale.txt')), false)
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('prepare 建出可用 profile 并把隔离注册表指向它', () => {
  const userDataDir = tempUserData()
  try {
    const paths = prepareDesktopSafeModeEnvironment(userDataDir)
    const profileDir = desktopSafeModeProfileDir(paths)
    assert.equal(lstatSync(profileDir).isDirectory(), true)
    // The profile must be usable without first-run setup, so it needs real
    // declarative files, not just an empty directory.
    assert.equal(existsSync(join(profileDir, 'package.json')), true)

    // The isolated state must select it — otherwise Safe Mode would fall back to
    // the default profile name and launch against the wrong directory.
    const registry = JSON.parse(readFileSync(join(paths.userDataDir, 'profile-registry.json'), 'utf8')) as { active: string }
    assert.equal(registry.active, DESKTOP_SAFE_MODE_PROFILE_NAME)
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('prepare 的环境完全落在隔离根内，绝不触碰真实 home', () => {
  const userDataDir = tempUserData()
  const savedHome = process.env.DSH_HOME
  try {
    const paths = prepareDesktopSafeModeEnvironment(userDataDir)
    const profileDir = desktopSafeModeProfileDir(paths)
    // Every path Safe Mode touches must sit under its own root. This is the whole
    // point of the feature: the real ~/.dsh must never be involved.
    for (const path of [paths.homeDir, paths.userDataDir, profileDir]) {
      assert.equal(
        isInside(path, paths.rootDir),
        true,
        `路径逃出了隔离根: ${path}`,
      )
    }
  } finally {
    restoreEnv('DSH_HOME', savedHome)
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('prepare 之后，启动器自己的 roots 解析仍落在隔离内（隔离失效的回归测试）', () => {
  // The real launcher resolves roots as `resolveProfileRoots({ stateDir: userData })`
  // — with NO `home`, so home comes from DSH_HOME. An earlier version of `prepare`
  // passed `home` explicitly when writing the registry but did not set DSH_HOME, so
  // the launcher resolved home to the REAL ~/.dsh and selected the real profile:
  // the isolated registry was never seen and isolation was silently defeated.
  const userDataDir = tempUserData()
  const savedHome = process.env.DSH_HOME
  try {
    const paths = prepareDesktopSafeModeEnvironment(userDataDir)

    // Exactly how main.ts does it — no `home` argument.
    const launcherRoots = resolveProfileRoots({ stateDir: paths.userDataDir })
    assert.equal(
      isInside(launcherRoots.home, paths.rootDir),
      true,
      `启动器解析出的 home 逃出了隔离根: ${launcherRoots.home}`,
    )
    assert.equal(readActiveProfile(launcherRoots), DESKTOP_SAFE_MODE_PROFILE_NAME)

    const launched = profileDirFor(launcherRoots.home, readActiveProfile(launcherRoots))
    assert.equal(isInside(launched, paths.rootDir), true, `会启动到隔离外的 profile: ${launched}`)
    assert.equal(existsSync(launched), true)
  } finally {
    restoreEnv('DSH_HOME', savedHome)
    rmSync(userDataDir, { recursive: true, force: true })
  }
})
