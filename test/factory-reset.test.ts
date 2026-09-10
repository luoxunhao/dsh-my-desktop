import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  assertFactoryResetTarget,
  factoryResetDataDirectory,
} from '../src/recovery/factory-reset.js'

/**
 * Factory reset — the most destructive operation in the product.
 *
 * The reference implementation keeps its safety checks in a dedicated function so
 * they can be reasoned about on their own. These tests drive that function
 * directly, because the whole point is that a bad target is refused BEFORE anything
 * is handed to the trash.
 *
 * The four refusals, each preventing a specific way of destroying more than the
 * user intended:
 *
 *   1. a filesystem root            — would trash an entire volume
 *   2. a non-directory / symlink    — would follow a link out of the intended tree
 *   3. a directory containing protected paths (the app's own userData)
 *   4. an uninitialized DSH home    — "reset" of something that was never ours
 */

function fixture(): { root: string, home: string, userDataDir: string, cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-factory-reset-'))
  const home = join(root, 'dsh-home')
  const userDataDir = join(root, 'user-data')
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  mkdirSync(userDataDir, { recursive: true })
  return { root, home, userDataDir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('接受一个已初始化的 DSH home', () => {
  const f = fixture()
  try {
    assert.equal(assertFactoryResetTarget(f.home, [f.userDataDir]), resolve(f.home))
  } finally {
    f.cleanup()
  }
})

test('拒绝文件系统根（否则会清空整块盘）', () => {
  const f = fixture()
  try {
    assert.throws(() => assertFactoryResetTarget(resolve('/'), [f.userDataDir]), /filesystem root/)
  } finally {
    f.cleanup()
  }
})

test('拒绝不存在的目录', () => {
  const f = fixture()
  try {
    assert.throws(() => assertFactoryResetTarget(join(f.root, 'nope'), [f.userDataDir]))
  } finally {
    f.cleanup()
  }
})

test('拒绝相对路径 / 含 NUL / 空串', () => {
  // COVERAGE NOTE (verified by mutation): these inputs are ALSO rejected by the
  // later guards, so removing `canonicalPath`'s own validation does not change the
  // observable outcome — it is defence in depth, not the sole protection. A test
  // cannot distinguish it, and pretending otherwise would be misleading.
  //
  // It stays because it is the only guard that rejects a NUL byte explicitly, and
  // because `canonicalPath` is also used for protectedPaths, where NO later check
  // would run. The assertion below therefore pins the CONTRACT ("illegal paths are
  // refused"), which is what callers depend on.
  const f = fixture()
  try {
    for (const bad of ['relative', '', `ok\0bad`]) {
      assert.throws(() => assertFactoryResetTarget(bad, [f.userDataDir]), `应拒绝: ${JSON.stringify(bad)}`)
    }
    // The place where this guard is genuinely load-bearing: a protected path is
    // validated but never otherwise inspected, so nothing else would catch a bad one.
    assert.throws(
      () => assertFactoryResetTarget(f.home, ['relative-protected-path']),
      /bounded absolute path/,
      'protectedPaths 的合法性只能由该守卫保证',
    )
  } finally {
    f.cleanup()
  }
})

test('拒绝符号链接目标（否则会顺着链接删掉别处）', () => {
  const f = fixture()
  const victim = mkdtempSync(join(tmpdir(), 'dsh-victim-'))
  try {
    mkdirSync(join(victim, 'profiles'), { recursive: true })
    const link = join(f.root, 'link-home')
    symlinkSync(victim, link, 'junction')
    assert.throws(
      () => assertFactoryResetTarget(link, [f.userDataDir]),
      /real directory|initialized/,
      '符号链接必须被拒绝',
    )
  } finally {
    f.cleanup()
    rmSync(victim, { recursive: true, force: true })
  }
})

test('拒绝「会包含受保护路径」的目录（否则会把应用自身状态一起清掉）', () => {
  const f = fixture()
  try {
    // userDataDir sits inside root, so resetting root would take the app's own
    // state with it — the app would come back with no idea who it is.
    assert.throws(
      () => assertFactoryResetTarget(f.root, [f.userDataDir]),
      /protected/,
    )
  } finally {
    f.cleanup()
  }
})

test('拒绝未初始化的 home（没有 profiles 目录）', () => {
  const f = fixture()
  try {
    const empty = join(f.root, 'empty-home')
    mkdirSync(empty)
    assert.throws(() => assertFactoryResetTarget(empty, [f.userDataDir]), /not an initialized/)
  } finally {
    f.cleanup()
  }
})

test('reset 把 home 交给 trash（可恢复），而不是永久删除', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.home, 'profiles', 'web', 'settings.yaml'), 'theme: dark\n')
    const trashed: string[] = []

    await factoryResetDataDirectory({
      homeDir: f.home,
      userDataDir: f.userDataDir,
      protectedPaths: [],
      // Injected so the safety boundary is testable without touching the OS trash.
      trashItem: async path => { trashed.push(path) },
      recreate: false,
    })

    // Recoverability is the difference between "factory reset" and "data loss".
    assert.deepEqual(trashed, [resolve(f.home)], '应交给 trash 而不是直接删')
  } finally {
    f.cleanup()
  }
})

test('reset 前会重新校验目标（预览与执行之间目标可能已变）', async () => {
  const f = fixture()
  try {
    const trashed: string[] = []
    // Removing `profiles` after a preview must make the execute fail closed.
    rmSync(join(f.home, 'profiles'), { recursive: true, force: true })

    await assert.rejects(
      factoryResetDataDirectory({
        homeDir: f.home,
        userDataDir: f.userDataDir,
        protectedPaths: [],
        trashItem: async path => { trashed.push(path) },
        recreate: false,
      }),
      /not an initialized/,
    )
    assert.deepEqual(trashed, [], '校验失败时不得触碰 trash')
  } finally {
    f.cleanup()
  }
})

test('reset 会在 trash 之后重建空的 home（供干净启动）', async () => {
  const f = fixture()
  try {
    const events: string[] = []
    await factoryResetDataDirectory({
      homeDir: f.home,
      userDataDir: f.userDataDir,
      protectedPaths: [],
      trashItem: async () => {
        events.push('trash')
        // Simulate the trash actually removing the directory.
        rmSync(f.home, { recursive: true, force: true })
      },
      recreate: true,
    })
    events.push(existsSync(f.home) ? 'recreated' : 'missing')
    assert.deepEqual(events, ['trash', 'recreated'])
    assert.equal(existsSync(join(f.home, 'profiles')), false, '重建的应是空 home')
  } finally {
    f.cleanup()
  }
})

test('recreate 关闭时不重建（用于只清空、不新建）', async () => {
  const f = fixture()
  try {
    await factoryResetDataDirectory({
      homeDir: f.home,
      userDataDir: f.userDataDir,
      protectedPaths: [],
      trashItem: async () => { rmSync(f.home, { recursive: true, force: true }) },
      recreate: false,
    })
    assert.equal(existsSync(f.home), false)
  } finally {
    f.cleanup()
  }
})

test('trash 失败时不重建（避免掩盖失败）', async () => {
  const f = fixture()
  try {
    await assert.rejects(
      factoryResetDataDirectory({
        homeDir: f.home,
        userDataDir: f.userDataDir,
        protectedPaths: [],
        trashItem: async () => { throw new Error('trash unavailable') },
        recreate: true,
      }),
      /trash unavailable/,
    )
    // The original home must still be intact — a failed reset must not leave the
    // user with neither their data nor a working directory.
    assert.equal(existsSync(join(f.home, 'profiles', 'web')), true)
  } finally {
    f.cleanup()
  }
})

test('userData 由入口自动加入保护列表（调用方无需自己记得）', async () => {
  // The low-level validator takes `protectedPaths` as given — the same shape the
  // reference uses, so it stays a pure predicate with no hidden knowledge of the
  // app's layout. The GUARANTEE lives one level up: the async entry point always
  // appends userData itself, so a caller cannot forget it.
  const f = fixture()
  try {
    // Give `root` a `profiles` directory so the "initialized home" check passes and
    // the protected-path check is genuinely the one being exercised.
    mkdirSync(join(f.root, 'profiles'), { recursive: true })

    const trashed: string[] = []
    await assert.rejects(
      factoryResetDataDirectory({
        homeDir: f.root,
        userDataDir: f.userDataDir,
        protectedPaths: [],
        trashItem: async path => { trashed.push(path) },
        recreate: false,
      }),
      /protected/,
      '入口必须自动保护 userData 并拒绝包含它的目标',
    )
    assert.deepEqual(trashed, [], '被拒绝时不得触碰 trash')

    // Explicitly listing it is equivalent — the entry point does not depend on it.
    assert.throws(() => assertFactoryResetTarget(f.root, [f.userDataDir]), /protected/)
  } finally {
    f.cleanup()
  }
})
