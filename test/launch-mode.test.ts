import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveLaunchDecision, skipsHost } from '../src/recovery/launch-mode.js'
import {
  DESKTOP_RECOVERY_MODE_ARGUMENT,
  DESKTOP_SAFE_MODE_ARGUMENT,
  desktopDefaultRelaunchArguments,
  desktopRecoveryRelaunchArguments,
} from '../src/recovery/relaunch-arguments.js'

/**
 * Which launch mode a given command line selects.
 *
 * This is the branch that decides whether the plugin host ever starts. Getting it
 * wrong in one direction strands every launch in the recovery assistant; in the
 * other, a user whose host cannot boot has no way in.
 */

test('无标记时是正常启动，且会启动 Host', () => {
  const decision = resolveLaunchDecision(['exe', '--some-flag'])
  assert.equal(decision.mode, 'normal')
  assert.equal(decision.startsHost, true)
  assert.equal(decision.capturesHealthyCheckpoint, true)
})

test('恢复标记 → 恢复模式，且不启动 Host', () => {
  const decision = resolveLaunchDecision(['exe', DESKTOP_RECOVERY_MODE_ARGUMENT])
  assert.equal(decision.mode, 'recovery')
  // The whole point: recovery must work when the host cannot start.
  assert.equal(decision.startsHost, false)
})

test('安全模式标记 → 安全模式，且不启动 Host', () => {
  const decision = resolveLaunchDecision(['exe', DESKTOP_SAFE_MODE_ARGUMENT])
  assert.equal(decision.mode, 'safe-mode')
  assert.equal(decision.startsHost, false)
})

test('恢复与安全模式同时存在时，恢复优先（它是通用修复路径）', () => {
  const decision = resolveLaunchDecision(['exe', DESKTOP_SAFE_MODE_ARGUMENT, DESKTOP_RECOVERY_MODE_ARGUMENT])
  assert.equal(decision.mode, 'recovery')
})

test('argv[0] 不参与判定（可执行文件路径含关键词也不会误触发）', () => {
  assert.equal(resolveLaunchDecision([DESKTOP_RECOVERY_MODE_ARGUMENT]).mode, 'normal')
})

test('前缀相似参数不触发（避免误命中）', () => {
  assert.equal(resolveLaunchDecision(['exe', `${DESKTOP_RECOVERY_MODE_ARGUMENT}-extra`]).mode, 'normal')
  assert.equal(resolveLaunchDecision(['exe', `${DESKTOP_SAFE_MODE_ARGUMENT}x`]).mode, 'normal')
})

test('恢复与安全模式都不拍快照（正在修状态，不应覆盖恢复点）', () => {
  // A checkpoint is a record of a state known to WORK. Overwriting it with a state
  // the user is repairing would destroy the very recovery point they came to use.
  for (const argv of [
    ['exe', DESKTOP_RECOVERY_MODE_ARGUMENT],
    ['exe', DESKTOP_SAFE_MODE_ARGUMENT],
  ]) {
    assert.equal(resolveLaunchDecision(argv).capturesHealthyCheckpoint, false)
  }
})

test('skipsHost 与 mode 一致', () => {
  assert.equal(skipsHost('normal'), false)
  assert.equal(skipsHost('recovery'), true)
  assert.equal(skipsHost('safe-mode'), true)
})

test('一次性语义：正常重启重建命令行后不再进入恢复', () => {
  // The marker must survive exactly one relaunch. If it leaked, every subsequent
  // launch would land in recovery with no way out.
  const afterRecoveryRelaunch = desktopRecoveryRelaunchArguments(['exe', '--keep'])
  assert.equal(resolveLaunchDecision(['exe', ...afterRecoveryRelaunch]).mode, 'recovery')

  const normalRebuild = desktopDefaultRelaunchArguments(['exe', ...afterRecoveryRelaunch])
  assert.equal(resolveLaunchDecision(['exe', ...normalRebuild]).mode, 'normal', '标记必须只存活一次重启')
})
