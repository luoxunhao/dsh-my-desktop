import assert from 'node:assert/strict'
import test from 'node:test'

import {
  restartConfirmationCopy,
  DESKTOP_RECOVERY_CONFIRM_DEFAULT_ID,
} from '../src/recovery/restart-confirmation.js'

/**
 * The confirmation shown before restarting into recovery.
 *
 * WHY THIS DESERVES TESTS
 * -----------------------
 * Entering recovery interrupts whatever is running. The reference implementation
 * therefore makes the dialog's DEFAULT button "Cancel" (`defaultId: 1`,
 * `cancelId: 1`). That single number is the difference between "press Enter to
 * abort" and "press Enter to blow away the running session", so it is pinned here
 * rather than left to review.
 */

test('默认按钮是「取消」，不是「确认」（防止回车即中断当前工作）', () => {
  const copy = restartConfirmationCopy('zh')
  // Index 0 is the confirm button, index 1 the cancel button.
  assert.equal(copy.buttons.length, 2)
  assert.equal(copy.defaultId, 1, '默认必须落在取消上')
  assert.equal(copy.cancelId, 1)
  assert.notEqual(copy.defaultId, 0)
})

test('确认按钮排在前面，取消在后（与默认索引对应）', () => {
  for (const locale of ['zh', 'en'] as const) {
    const copy = restartConfirmationCopy(locale)
    assert.equal(copy.buttons[0], copy.confirm)
    assert.equal(copy.buttons[1], copy.cancel)
  }
})

test('中英文文案都存在且非空', () => {
  for (const locale of ['zh', 'en'] as const) {
    const copy = restartConfirmationCopy(locale)
    for (const field of ['title', 'message', 'detail', 'confirm', 'cancel'] as const) {
      assert.equal(typeof copy[field], 'string')
      assert.notEqual(copy[field].trim(), '', `${locale}.${field} 不应为空`)
    }
  }
})

test('文案说明会中断当前操作（避免用户误以为无损）', () => {
  const zh = restartConfirmationCopy('zh')
  const en = restartConfirmationCopy('en')
  // The detail is the part that actually sets expectations about data loss.
  assert.match(zh.detail, /中断/)
  assert.match(en.detail, /interrupt/i)
  // And it must state what is NOT lost, so the user can decide.
  assert.match(zh.detail, /不会丢失/)
  assert.match(en.detail, /will not be lost/i)
})

test('恢复模式的文案与普通重启不同（用户要能区分）', () => {
  const recovery = restartConfirmationCopy('zh', 'recovery')
  const normal = restartConfirmationCopy('zh', 'normal')
  assert.notEqual(recovery.title, normal.title)
  assert.notEqual(recovery.confirm, normal.confirm)
  // The recovery copy must explain WHEN the assistant appears, since that is the
  // observable difference from a normal restart.
  assert.match(recovery.detail, /恢复|Host/)
})

test('未指定目标时默认为普通重启（安全默认）', () => {
  assert.deepEqual(restartConfirmationCopy('zh'), restartConfirmationCopy('zh', 'normal'))
})

test('默认索引常量与文案表一致', () => {
  assert.equal(DESKTOP_RECOVERY_CONFIRM_DEFAULT_ID, 1)
  assert.equal(restartConfirmationCopy('zh').defaultId, DESKTOP_RECOVERY_CONFIRM_DEFAULT_ID)
})
