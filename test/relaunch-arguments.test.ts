import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DESKTOP_RECOVERY_MODE_ARGUMENT,
  DESKTOP_SAFE_MODE_ARGUMENT,
  desktopDefaultRelaunchArguments,
  desktopRecoveryModeRequested,
  desktopRecoveryRelaunchArguments,
  desktopSafeModeRequested,
  desktopSafeModeRelaunchArguments,
} from '../src/recovery/relaunch-arguments.js'

/** A plausible packaged-app command line (argv[0] is the executable). */
const base = ['DSH My Desktop.exe', '--some-flag', 'value']

test('恢复标记是精确匹配，不接受前缀变体', () => {
  assert.equal(desktopRecoveryModeRequested([...base, DESKTOP_RECOVERY_MODE_ARGUMENT]), true)
  // A lookalike must NOT trigger recovery — prefix matching would be a real hazard.
  assert.equal(desktopRecoveryModeRequested([...base, `${DESKTOP_RECOVERY_MODE_ARGUMENT}-extra`]), false)
  assert.equal(desktopRecoveryModeRequested([...base, 'x--dsh-desktop-recovery']), false)
  assert.equal(desktopRecoveryModeRequested(base), false)
})

test('argv[0] 不参与检测（只有 slice(1) 被检查）', () => {
  // If argv[0] were included, an executable path containing the marker would
  // silently force recovery mode on every launch.
  assert.equal(desktopRecoveryModeRequested([DESKTOP_RECOVERY_MODE_ARGUMENT]), false)
})

test('重建命令行会滤掉两个一次性标记，保留其它参数与顺序', () => {
  const withMarkers = [...base, DESKTOP_RECOVERY_MODE_ARGUMENT, '--tail', DESKTOP_SAFE_MODE_ARGUMENT]
  // slice(1) drops argv[0] (the executable) — relaunch args never re-include it.
  assert.deepEqual(desktopDefaultRelaunchArguments(withMarkers), ['--some-flag', 'value', '--tail'])
  assert.deepEqual(desktopDefaultRelaunchArguments(base), ['--some-flag', 'value'])
})

test('一次性语义：加了恢复标记后，再重建不会保留它', () => {
  const recoveryArgv = desktopRecoveryRelaunchArguments(base)
  assert.equal(recoveryArgv.includes(DESKTOP_RECOVERY_MODE_ARGUMENT), true)
  // The next normal relaunch drops the marker — this is what stops recovery from
  // re-entering itself forever.
  assert.deepEqual(desktopDefaultRelaunchArguments(['exe', ...recoveryArgv]), ['--some-flag', 'value'])
})

test('恢复与安全模式标记互不串扰', () => {
  const recovery = ['exe', ...desktopRecoveryRelaunchArguments(base)]
  assert.equal(desktopRecoveryModeRequested(recovery), true)
  assert.equal(desktopSafeModeRequested(recovery), false)

  const safe = ['exe', ...desktopSafeModeRelaunchArguments(base)]
  assert.equal(desktopSafeModeRequested(safe), true)
  assert.equal(desktopRecoveryModeRequested(safe), false)
})

test('重复加标记不会累积', () => {
  const once = desktopRecoveryRelaunchArguments(base)
  // Rebuilding an already-marked line and re-adding yields exactly one marker.
  const twice = desktopRecoveryRelaunchArguments(['exe', ...once])
  assert.equal(twice.filter(arg => arg === DESKTOP_RECOVERY_MODE_ARGUMENT).length, 1)
})
