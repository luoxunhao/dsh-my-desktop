import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'

import { createProfileActionsService } from '../src/desktop/profile-actions-service.js'
import {
  DESKTOP_RECOVERY_MODE_ARGUMENT,
  DESKTOP_SAFE_MODE_ARGUMENT,
  desktopRecoveryModeRequested,
} from '../src/recovery/relaunch-arguments.js'

/**
 * Profile switching must relaunch into NORMAL mode.
 *
 * THE BUG THIS PINS
 * -----------------
 * `restartDesktop` called a bare `app.relaunch()`, which inherits the current
 * process's argv. Launch a generation in recovery (or safe) mode, switch profiles
 * from the settings page, and the one-shot marker rode along into the next
 * generation — so the app came back up in the recovery assistant instead of the
 * newly selected profile. On a profile with no snapshots that strands the user.
 *
 * `desktopDefaultRelaunchArguments` exists precisely to rebuild the command line
 * without those markers; the sibling `restart-service` already used it, and this
 * module did not. The path had no test at all, which is why it survived.
 *
 * The relaunch/exit Electron touchpoints are injected, so the ARGUMENTS are
 * observable here without an Electron runtime.
 */
async function harness(t: TestContext, argv: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-profile-actions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const relaunches: string[][] = []
  let exited = false
  const service = createProfileActionsService({
    lastSeedOptions: () => undefined,
    isQuitting: () => false,
    dshView: () => undefined,
    shutdown: async (exit) => { exit() },
    argv: () => [...argv],
    userDataDir: () => root,
    relaunch: args => { relaunches.push([...args]) },
    exit: () => { exited = true },
    requestRecoveryRestart: async () => {},
  })
  return { service, relaunches, exited: () => exited, root }
}

test('从恢复模式的一代里重启桌面，不带恢复标记（否则切 profile 会回到恢复页）', async t => {
  const recoveryArgv = ['DSH My Desktop.exe', '--some-flag', DESKTOP_RECOVERY_MODE_ARGUMENT]
  const h = await harness(t, recoveryArgv)
  await h.service.restartDesktop()
  assert.equal(h.exited(), true, '应注册重启后退出')
  assert.equal(h.relaunches.length, 1, '应恰好重启一次')
  const args = h.relaunches[0]!
  assert.equal(
    desktopRecoveryModeRequested(['exe', ...args]),
    false,
    '重启参数不能携带恢复标记，否则新一代又进恢复模式',
  )
  assert.deepEqual(args, ['--some-flag'], '保留普通参数、剔除一次性标记')
})

test('安全模式标记同样被剔除', async t => {
  const h = await harness(t, ['exe', DESKTOP_SAFE_MODE_ARGUMENT, '--keep'])
  await h.service.restartDesktop()
  assert.deepEqual(h.relaunches[0], ['--keep'])
})

test('普通参数原样保留且顺序不变', async t => {
  const h = await harness(t, ['exe', '--a', '1', '--b'])
  await h.service.restartDesktop()
  assert.deepEqual(h.relaunches[0], ['--a', '1', '--b'])
})

test('退出中不再发起重启（幂等）', async t => {
  const relaunches: string[][] = []
  const service = createProfileActionsService({
    lastSeedOptions: () => undefined,
    isQuitting: () => true,
    dshView: () => undefined,
    shutdown: async (exit) => { exit() },
    argv: () => ['exe'],
    userDataDir: () => 'C:/tmp/test-userdata',
    relaunch: args => { relaunches.push([...args]) },
    exit: () => {},
    requestRecoveryRestart: async () => {},
  })
  await service.restartDesktop()
  assert.equal(relaunches.length, 0, '已在退出流程中时不应再注册重启')
})
