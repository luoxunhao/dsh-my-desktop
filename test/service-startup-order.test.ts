import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

/**
 * Startup-ordering guard for the service composition root.
 *
 * WHY THIS EXISTS
 * ---------------
 * A real crash shipped from this exact mistake: `ensureWindowsNotificationIdentity()`
 * was left near the top of `startApplication()`, but it had become a delegation to
 * `requireNotificationService()`. The service is not created until later in the same
 * function, so the app died during startup with
 *
 *     Error: 通知服务尚未初始化。
 *
 * before any error UI could render — and because `state` was also still undefined at
 * that point, the error reporter itself threw, so nothing was logged either. That
 * made the failure maximally hard to diagnose: the app simply vanished.
 *
 * The `require*` guards are correct (fail fast beats silently using a half-built
 * service), so the fix is to keep every delegation AFTER its factory runs. This test
 * enforces that mechanically, because the type system cannot: the call is perfectly
 * well-typed, it just happens too early.
 */
const mainSource = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')

/** Extract the body of `startApplication` (top-level function, closing brace at column 0). */
function startApplicationBody(source: string): string {
  const start = source.indexOf('async function startApplication(')
  assert.ok(start >= 0, '未找到 startApplication')
  const bodyStart = source.indexOf('\n', source.indexOf('{', start))
  const end = source.indexOf('\n}', bodyStart)
  assert.ok(end > bodyStart, '未找到 startApplication 的函数体结尾')
  return source.slice(bodyStart, end)
}

test('每个 require*Service 调用都在其工厂创建之后', () => {
  const body = startApplicationBody(mainSource)
  const lines = body.split(/\r?\n/)

  // Where each service variable is assigned by its factory.
  const created = new Map<string, number>()
  for (const [index, line] of lines.entries()) {
    const match = /^\s*(\w+)\s*=\s*create\w+\(/.exec(line)
    if (match !== null) created.set(match[1]!, index)
  }
  assert.ok(created.size >= 4, `应至少识别出 4 个服务工厂，实际 ${created.size}`)

  // Every `require<X>()` call must come after X was created.
  const violations: string[] = []
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/require(\w+)\(\)/g)) {
      const variable = match[1]!
      const at = created.get(variable)
      if (at === undefined) {
        violations.push(`第 ${index + 1} 行调用了 require${variable}()，但没有找到它的工厂赋值`)
        continue
      }
      if (index < at) {
        violations.push(`第 ${index + 1} 行调用 require${variable}()，但它直到第 ${at + 1} 行才被创建`)
      }
    }
  }
  assert.deepEqual(violations, [], `startApplication 中存在过早的服务调用：\n${violations.join('\n')}`)
})

test('服务工厂之间存在依赖时，被依赖者先创建（tray 依赖 updater 与 notifications）', () => {
  const body = startApplicationBody(mainSource)
  const at = (name: string): number => {
    const match = new RegExp(`^\\s*${name}\\s*=\\s*create\\w+\\(`, 'm').exec(body)
    assert.ok(match !== null, `未找到 ${name} 的工厂调用`)
    return body.slice(0, match.index).split(/\r?\n/).length
  }
  // The tray drives check/download/install and refreshes on status change, so both
  // services it talks to must already exist when it is wired.
  assert.ok(at('notificationService') < at('trayService'), '托盘在通知服务之前创建了')
  assert.ok(at('updateService') < at('trayService'), '托盘在更新服务之前创建了')
})

test('偏好路径不得依赖任何服务（加载偏好需要它，而偏好用于构造服务）', async () => {
  // A second real crash came from exactly this: `notificationPreferencesPath()` was
  // a service delegation, but startApplication needs it to LOAD the preferences
  // that are then handed to that same service's factory — a cycle. The paths
  // therefore live in a leaf module that imports nothing app-internal.
  const paths = await readFile(new URL('../../src/desktop/preference-paths.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(paths, /require\w+Service/, '偏好路径模块不得引用任何服务（会成环）')
  assert.doesNotMatch(paths, /from '\.\/(notification|update|tray)-service/, '偏好路径模块不得 import 服务模块')
  for (const name of ['notificationPreferencesPath', 'updatePreferencesPath']) {
    assert.match(paths, new RegExp(`export function ${name}\\(`), `${name} 应由 preference-paths.ts 导出`)
    assert.doesNotMatch(
      mainSource,
      new RegExp(`function ${name}\\(\\)[^}]*require\\w+Service`),
      `main.ts 不得把 ${name} 委派给服务`,
    )
  }
})
