import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  openRecoveryTarget,
  RECOVERY_OPEN_TARGETS,
  type RecoveryOpenTarget,
} from '../src/recovery/open-targets.js'

/**
 * Opening the recovery page's config files in the OS.
 *
 * THE SECURITY PROPERTY THAT MATTERS
 * ----------------------------------
 * The renderer must NOT be able to name a path. If it could, a compromised — or
 * merely buggy — recovery page would gain "open any file on the machine", which is
 * a real privilege boundary crossing (the page is sandboxed and has no filesystem
 * access otherwise).
 *
 * So the page sends an ACTION NAME from a fixed allowlist, and the main process
 * decides which path that means. The tests below pin that: unknown names are
 * refused, and no caller-supplied path is ever honoured.
 */

function fixture(): {
  root: string
  home: string
  profileDir: string
  cleanup: () => void
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-open-'))
  const home = join(root, 'dsh-home')
  const profileDir = join(home, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(home, 'settings.yaml'), 'theme: dark\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profileDir, 'package.json'), '{"name":"x"}\n')
  return { root, home, profileDir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** Collect the paths the injected opener was asked to open. */
function opener(log: string[]): (path: string) => Promise<string> {
  return async path => {
    log.push(path)
    return '' // Electron's openPath returns '' on success.
  }
}

function context(f: ReturnType<typeof fixture>) {
  return { homeDir: f.home, profileDir: f.profileDir }
}

test('每个允许的动作都解析到预期路径', async () => {
  const f = fixture()
  try {
    const expected: Record<RecoveryOpenTarget, string> = {
      'settings-document': join(f.home, 'settings.yaml'),
      'profile-patch': join(f.profileDir, 'cordis.patch.yml'),
      'profile-manifest': join(f.profileDir, 'package.json'),
      'profile-directory': f.profileDir,
    }
    for (const [target, path] of Object.entries(expected) as Array<[RecoveryOpenTarget, string]>) {
      const log: string[] = []
      await openRecoveryTarget(target, context(f), opener(log))
      assert.deepEqual(log, [resolve(path)], `${target} 应打开 ${path}`)
    }
  } finally {
    f.cleanup()
  }
})

test('动作清单是固定的四个，且不接受任意额外动作', () => {
  assert.deepEqual(
    [...RECOVERY_OPEN_TARGETS].sort(),
    ['profile-directory', 'profile-manifest', 'profile-patch', 'settings-document'],
  )
})

test('拒绝未知动作（页面无法借此打开任意文件）', async () => {
  const f = fixture()
  try {
    const log: string[] = []
    for (const bogus of ['../../etc/passwd', 'C:\\Windows\\System32\\config\\SAM', 'anything', '']) {
      await assert.rejects(
        openRecoveryTarget(bogus as RecoveryOpenTarget, context(f), opener(log)),
        /unknown recovery open target/,
        `应拒绝: ${JSON.stringify(bogus)}`,
      )
    }
    assert.deepEqual(log, [], '未知动作不得触碰打开器')
  } finally {
    f.cleanup()
  }
})

test('绝不接受调用方提供的路径（只认动作名）', async () => {
  const f = fixture()
  const outside = join(f.root, 'secret.txt')
  try {
    writeFileSync(outside, 'do not open me via a path\n')
    const log: string[] = []
    // A path-shaped string must be treated as an unknown ACTION, not opened.
    for (const pathish of [outside, resolve(f.home), './settings.yaml']) {
      await assert.rejects(
        openRecoveryTarget(pathish as RecoveryOpenTarget, context(f), opener(log)),
        /unknown recovery open target/,
      )
    }
    assert.deepEqual(log, [], '路径形式的名字不得被当作路径打开')
  } finally {
    f.cleanup()
  }
})

test('文件不存在时给出可读错误，而不是静默成功', async () => {
  const f = fixture()
  try {
    rmSync(join(f.home, 'settings.yaml'))
    await assert.rejects(
      openRecoveryTarget('settings-document', context(f), opener([])),
      /does not exist/,
    )
  } finally {
    f.cleanup()
  }
})

test('打开器返回错误描述时向上传递（openPath 用返回值表示失败）', async () => {
  const f = fixture()
  try {
    // Electron's shell.openPath resolves with '' on success and a message on
    // failure — it does NOT reject. Ignoring the return value hides every failure.
    await assert.rejects(
      openRecoveryTarget('profile-patch', context(f), async () => 'No application is associated'),
      /No application is associated/,
    )
  } finally {
    f.cleanup()
  }
})

test('profile 目录本身允许打开（不要求是文件）', async () => {
  const f = fixture()
  try {
    const log: string[] = []
    await openRecoveryTarget('profile-directory', context(f), opener(log))
    assert.deepEqual(log, [resolve(f.profileDir)])
  } finally {
    f.cleanup()
  }
})
