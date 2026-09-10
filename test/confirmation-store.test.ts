import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONFIRMATION_PREVIEW_TTL_MS,
  MAX_CONFIRMATION_PREVIEWS,
  createConfirmationStore,
} from '../src/recovery/confirmation-store.js'

/**
 * Two-phase confirmation for destructive operations.
 *
 * WHY THIS EXISTS
 * ---------------
 * Uninstalling a plugin or rolling back a checkpoint cannot be undone by the user.
 * A single click is too easy to misfire, so the page first asks for a PREVIEW —
 * which is also where it can show what would change — and only then EXECUTES with a
 * token from that preview.
 *
 * THE PROPERTIES THAT MATTER
 * --------------------------
 * 1. **One-shot.** A token is consumed by the first execute attempt, SUCCESSFUL OR
 *    NOT. Otherwise a failed operation could be replayed, and a token observed in a
 *    log would stay usable for its whole lifetime.
 * 2. **Time-bounded.** A preview the user never acted on expires.
 * 3. **Bound to a target.** A token minted for slot-2 must not execute against
 *    anything else.
 * 4. **Bounded memory.** Previews accumulate on every click, so the store has a cap.
 *
 * Time is injected so all of this is testable without waiting.
 */

const SLOT = 'slot-2'

function harness(): {
  store: ReturnType<typeof createConfirmationStore>
  advance: (ms: number) => void
  now: () => number
} {
  let clock = 1_000_000
  const store = createConfirmationStore({ now: () => clock })
  return { store, advance: ms => { clock += ms }, now: () => clock }
}

test('preview 返回可执行令牌与过期时间', () => {
  const h = harness()
  const preview = h.store.preview('checkpoint-restore', SLOT)
  assert.equal(typeof preview.previewId, 'string')
  assert.ok(preview.previewId.length > 0)
  // Expiry is reported so the page can warn before the user acts.
  assert.equal(Date.parse(preview.expiresAt), h.now() + CONFIRMATION_PREVIEW_TTL_MS)
  assert.equal(preview.target, SLOT)
  assert.equal(preview.action, 'checkpoint-restore')
})

test('execute 消费令牌并执行操作', async () => {
  const h = harness()
  const preview = h.store.preview('plugin-uninstall', 'some-plugin')
  const performed: string[] = []
  const outcome = await h.store.execute(preview.previewId, async () => {
    performed.push('ran')
    return 'done'
  })
  assert.equal(outcome.status, 'executed')
  assert.deepEqual(performed, ['ran'])
})

test('令牌是一次性的：第二次 execute 必须失败', async () => {
  const h = harness()
  const preview = h.store.preview('plugin-uninstall', 'some-plugin')
  await h.store.execute(preview.previewId, async () => 'ok')
  const second = await h.store.execute(preview.previewId, async () => 'ok')
  assert.equal(second.status, 'expired')
  // "already-consumed" rather than "unknown": the token WAS valid, and telling the
  // user that is more useful than "no such token".
  assert.equal(second.status === 'expired' ? second.reason : '', 'already-consumed')
})

test('失败或成功都只执行一次 —— 两个独立机制各自足够（纵深防御）', async () => {
  // MUTATION NOTE: removing EITHER the `claimed` flag OR the `previews.delete()`
  // leaves this behaviour unchanged, because either one alone blocks a replay. The
  // mechanisms are redundant ON PURPOSE: `delete` is the primary guard, and
  // `claimed` covers the window before it (and any future refactor that defers the
  // delete). Because neither is individually observable, a test cannot attribute
  // the protection to one of them — so this pins the CONTRACT instead, and the
  // mutation record is kept here rather than implying coverage that does not exist.
  const h = harness()
  for (const outcome of ['success', 'failure'] as const) {
    const preview = h.store.preview('plugin-uninstall', `p-${outcome}`)
    let runs = 0
    const operation = async (): Promise<string> => {
      runs += 1
      if (outcome === 'failure') throw new Error('boom')
      return 'ok'
    }
    const first = await h.store.execute(preview.previewId, operation)
    const second = await h.store.execute(preview.previewId, operation)
    assert.equal(runs, 1, `${outcome}: 操作只能执行一次`)
    assert.equal(first.status, outcome === 'success' ? 'executed' : 'failed')
    assert.equal(second.status, 'expired')
    assert.equal(second.status === 'expired' ? second.reason : '', 'already-consumed')
  }
})

test('失败的执行同样消费令牌（不允许重放）', async () => {
  const h = harness()
  const preview = h.store.preview('plugin-uninstall', 'some-plugin')
  const first = await h.store.execute(preview.previewId, async () => {
    throw new Error('operation failed')
  })
  assert.equal(first.status, 'failed')
  // The token must NOT survive a failure: replaying a destructive operation against
  // unknown partial state is worse than asking the user to preview again.
  const retry = await h.store.execute(preview.previewId, async () => 'ok')
  assert.equal(retry.status, 'expired')
})

test('并发 execute 同一令牌只执行一次', async () => {
  const h = harness()
  const preview = h.store.preview('plugin-uninstall', 'p')
  let runs = 0
  const operation = async (): Promise<string> => {
    runs += 1
    await new Promise(resolve => setTimeout(resolve, 5))
    return 'ok'
  }
  const results = await Promise.all([
    h.store.execute(preview.previewId, operation),
    h.store.execute(preview.previewId, operation),
    h.store.execute(preview.previewId, operation),
  ])
  assert.equal(runs, 1, '同一令牌并发执行只应真正执行一次')
  assert.equal(results.filter(result => result.status === 'executed').length, 1)
  assert.equal(results.filter(result => result.status === 'expired').length, 2)
})

test('过期的令牌不能执行', async () => {
  const h = harness()
  const preview = h.store.preview('checkpoint-restore', SLOT)
  h.advance(CONFIRMATION_PREVIEW_TTL_MS + 1)
  const outcome = await h.store.execute(preview.previewId, async () => 'ok')
  assert.equal(outcome.status, 'expired')
  assert.equal(outcome.status === 'expired' ? outcome.reason : '', 'expired')
})

test('未知令牌不能执行', async () => {
  const h = harness()
  const outcome = await h.store.execute('preview_does-not-exist', async () => 'ok')
  assert.equal(outcome.status, 'expired')
  assert.equal(outcome.status === 'expired' ? outcome.reason : '', 'unknown')
})

test('目标不匹配时拒绝（令牌绑定到它预览的目标）', async () => {
  const h = harness()
  const preview = h.store.preview('checkpoint-restore', SLOT)
  // A token minted for slot-2 must never drive a different target: the user
  // approved slot-2, and acting on anything else would be unauthorised.
  const outcome = await h.store.execute(preview.previewId, async () => 'ok', { expectTarget: 'slot-3' })
  assert.equal(outcome.status, 'expired')
  assert.equal(outcome.status === 'expired' ? outcome.reason : '', 'target-mismatch')
})

test('preview 数量有上限，超出时丢弃最早的', () => {
  const h = harness()
  const ids: string[] = []
  for (let index = 0; index < MAX_CONFIRMATION_PREVIEWS + 5; index += 1) {
    ids.push(h.store.preview('plugin-uninstall', `plugin-${index}`).previewId)
  }
  assert.equal(h.store.size(), MAX_CONFIRMATION_PREVIEWS)
  // The cap exists because previews accumulate on every click; without it a
  // long-lived window would grow without bound.
  assert.equal(h.store.has(ids[0]!), false, '最早的应被丢弃')
  assert.equal(h.store.has(ids[ids.length - 1]!), true, '最新的应保留')
})

test('过期的预览会被清理，不占用上限', () => {
  const h = harness()
  for (let index = 0; index < 10; index += 1) h.store.preview('plugin-uninstall', `p-${index}`)
  h.advance(CONFIRMATION_PREVIEW_TTL_MS + 1)
  const after = h.store.preview('plugin-uninstall', 'fresh')
  // A stale entry must not be able to evict a live one.
  assert.equal(h.store.has(after.previewId), true)
  assert.ok(h.store.size() < 10, '过期的应被清理')
})

test('每次 preview 产生不同令牌', () => {
  const h = harness()
  const first = h.store.preview('checkpoint-restore', SLOT)
  const second = h.store.preview('checkpoint-restore', SLOT)
  assert.notEqual(first.previewId, second.previewId, '令牌不可复用')
})

test('TTL 为 5 分钟（与参考实现一致）', () => {
  assert.equal(CONFIRMATION_PREVIEW_TTL_MS, 5 * 60 * 1000)
})
