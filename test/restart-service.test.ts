import assert from 'node:assert/strict'
import test from 'node:test'

import { DESKTOP_RECOVERY_MODE_ARGUMENT, desktopDefaultRelaunchArguments, desktopRecoveryRelaunchArguments } from '../src/recovery/relaunch-arguments.js'
import { createRestartService, type RestartMessageBoxOptions } from '../src/recovery/restart-service.js'

/**
 * Restart orchestration.
 *
 * The service imports nothing from `electron`, so these tests run under plain
 * `node` and drive it entirely through injected callbacks. What they pin is not
 * the wiring but three behaviours that are easy to get wrong and expensive when
 * wrong: only the confirm button restarts, a double request relaunches ONCE, and
 * relaunch is registered BEFORE the app exits.
 */

interface Harness {
  dialogs: RestartMessageBoxOptions[]
  relaunches: Array<string[] | undefined>
  events: string[]
  exits: number[]
  service: ReturnType<typeof createRestartService>
}

function harness(options: { response?: number | (() => number), locale?: string } = {}): Harness {
  const dialogs: RestartMessageBoxOptions[] = []
  const relaunches: Array<string[] | undefined> = []
  const events: string[] = []
  const exits: number[] = []
  const service = createRestartService({
    locale: () => options.locale ?? 'zh',
    argv: () => ['exe', '--keep-me'],
    relaunch: args => {
      events.push('relaunch')
      relaunches.push(args)
    },
    exit: code => {
      events.push('exit')
      exits.push(code)
    },
    shutdown: async action => {
      events.push('shutdown')
      action()
    },
    confirm: async dialogOptions => {
      dialogs.push(dialogOptions)
      const response = typeof options.response === 'function' ? options.response() : (options.response ?? 0)
      return { response }
    },
  })
  return { dialogs, relaunches, events, exits, service }
}

test('确认后才重启；取消则什么都不做', async () => {
  const cancelled = harness({ response: 1 })
  await cancelled.service.requestRecoveryRestart()
  assert.equal(cancelled.dialogs.length, 1)
  assert.equal(cancelled.service.isRestartRequested(), false, '取消后不应登记重启')
  assert.deepEqual(cancelled.relaunches, [], '取消后不应重启')

  const confirmed = harness({ response: 0 })
  await confirmed.service.requestRecoveryRestart()
  assert.equal(confirmed.service.isRestartRequested(), true, '确认后应登记重启')
})

test('弹窗默认落在「取消」上（回车不会误重启）', async () => {
  const h = harness({ response: 1 })
  await h.service.requestRecoveryRestart()
  const shown = h.dialogs[0]!
  assert.equal(shown.type, 'question')
  assert.equal(shown.defaultId, 1)
  assert.equal(shown.cancelId, 1)
  assert.equal(shown.noLink, true)
})

test('恢复模式与普通重启使用不同文案', async () => {
  const recovery = harness()
  await recovery.service.requestRecoveryRestart()
  const normal = harness()
  await normal.service.requestRestart()
  assert.notEqual(recovery.dialogs[0]!.title, normal.dialogs[0]!.title)
})

test('并发请求只重启一次（防连点）', async () => {
  const h = harness()
  await Promise.all([
    h.service.requestRecoveryRestart(),
    h.service.requestRecoveryRestart(),
    h.service.requestRecoveryRestart(),
  ])
  // The shared in-flight promise means only ONE dialog is ever shown.
  assert.equal(h.dialogs.length, 1, '并发请求应共享同一次确认')
  assert.equal(h.relaunches.length, 1, '只应重启一次')
})

test('重启过一次后不再重启（幂等）', async () => {
  const h = harness()
  await h.service.requestRecoveryRestart()
  await h.service.requestRecoveryRestart()
  assert.equal(h.dialogs.length, 1, '已登记重启后不应再次弹窗')
  assert.equal(h.relaunches.length, 1)
})

test('顺序：先登记 relaunch、再有序关停、最后退出', async () => {
  const h = harness()
  await h.service.requestRecoveryRestart()
  // relaunch before exit is the property that matters: reversing them leaves the
  // app gone with nothing scheduled to replace it (indistinguishable from a crash).
  assert.deepEqual(h.events, ['relaunch', 'shutdown', 'exit'])
  assert.ok(h.events.indexOf('relaunch') < h.events.indexOf('exit'))
  assert.deepEqual(h.exits, [0])
})

test('取消后仍可再次请求（不是一次性的）', async () => {
  let response = 1
  const h = harness({ response: () => response })
  await h.service.requestRecoveryRestart()
  assert.equal(h.service.isRestartRequested(), false)
  // The user changes their mind and confirms on the second attempt.
  response = 0
  await h.service.requestRecoveryRestart()
  assert.equal(h.service.isRestartRequested(), true)
  assert.equal(h.dialogs.length, 2)
})

test('恢复重启带上一次性标记，且保留原有 argv', async () => {
  const h = harness()
  await h.service.requestRecoveryRestart()
  const args = h.relaunches[0]
  assert.ok(args !== undefined, '恢复重启必须带参数')
  assert.equal(args.includes(DESKTOP_RECOVERY_MODE_ARGUMENT), true)
  // The original arguments survive, minus argv[0] and any stale marker.
  assert.equal(args.includes('--keep-me'), true)
  assert.deepEqual(args, desktopRecoveryRelaunchArguments(['exe', '--keep-me']))
})

test('普通重启重建命令行（剔除一次性标记）—— 裸 relaunch 会继承恢复标记', async () => {
  // THE BUG THIS PINS: a normal restart used to relaunch with NO arguments, so the
  // injected relaunch fell back to a bare app.relaunch() that inherits the current
  // argv. Restarting from a recovery generation therefore carried the one-shot
  // marker into the next generation and the app spun back into recovery forever.
  const h = harness()
  await h.service.requestRestart()
  assert.deepEqual(h.relaunches, [desktopDefaultRelaunchArguments(['exe', '--keep-me'])])
  const args = h.relaunches[0]!
  assert.equal(args.includes(DESKTOP_RECOVERY_MODE_ARGUMENT), false, '不得携带恢复标记')
  assert.equal(args.includes('--keep-me'), true, '普通参数保留')
})

test('恢复重启不会累积重复标记', async () => {
  const h = harness()
  // Pretend a previous recovery relaunch left the marker in argv.
  const service = createRestartService({
    locale: () => 'zh',
    argv: () => ['exe', DESKTOP_RECOVERY_MODE_ARGUMENT],
    relaunch: args => h.relaunches.push(args),
    exit: () => {},
    shutdown: async action => { action() },
    confirm: async () => ({ response: 0 }),
  })
  await service.requestRecoveryRestart()
  const args = h.relaunches[0]!
  assert.equal(args.filter(arg => arg === DESKTOP_RECOVERY_MODE_ARGUMENT).length, 1, '标记不应重复')
})
