import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

/**
 * Design guard for the late-binding contract of the mutable state store.
 *
 * The IPC handlers registered by `installShellIpc` / `installRecoveryIpc` run long
 * after startup, and they dereference windows that are created EARLIER in
 * `startApplication`. That only works because they read `state.windows.*` at event
 * time. If a window (or any store slice) were passed BY VALUE into the registration
 * call, the handler would capture `undefined` forever and silently do nothing —
 * every top-bar action would become a no-op.
 *
 * The type system cannot catch this: `BrowserWindow | undefined` and
 * `BrowserWindow` both accept a value argument. So this static check is the guard.
 *
 * Precedent: `dsh-view-preload.test.ts` reads source text and asserts on it.
 */
const mainSource = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')

/** Extract the argument list text of a call like `installShellIpc(...)`. */
function callArguments(source: string, callee: string): string[] {
  const found: string[] = []
  const pattern = new RegExp(`\\b${callee}\\s*\\(([^)]*)\\)`, 'g')
  for (const match of source.matchAll(pattern)) found.push(match[1] ?? '')
  return found
}

test('IPC 注册函数不得按值接收窗口或 store 切片（晚绑定护栏）', () => {
  for (const callee of ['installShellIpc', 'installRecoveryIpc', 'installDesktopFaviconReplacement']) {
    const calls = callArguments(mainSource, callee)
    assert.ok(calls.length > 0, `未找到 ${callee} 的调用处 —— 护栏失效，请更新此测试`)
    for (const args of calls) {
      // Passing window handles or the store by value captures undefined at
      // registration time; handlers must read state.* at event time instead.
      assert.doesNotMatch(
        args,
        /state\./,
        `${callee} 的调用处传入了 store 切片（${args.trim()}）：会永久捕获 undefined，`
        + '所有 handler 静默失效。应让 handler 在事件触发时读取 state.*。',
      )
    }
  }
})

test('窗口句柄必须在事件触发时读取，不能在注册时捕获', () => {
  // The handlers must reach windows through the store at call time.
  assert.match(mainSource, /state\.windows\.mainWindow/, '主窗口应通过 store 在调用时读取')
  assert.match(mainSource, /state\.windows\.dshView/, 'DSH 视图应通过 store 在调用时读取')

  // A local snapshot of a window handle bound at registration scope is the bug shape:
  //   const window = state.windows.mainWindow   // at registration time
  //   ipcMain.on(..., () => window.close())
  // Legitimate reads happen inside handler bodies, not in the registration preamble.
  const registration = /function installShellIpc\(\)[\s\S]*?\n\}/.exec(mainSource)?.[0]
  assert.ok(registration !== undefined, '未找到 installShellIpc 函数体')
  for (const name of ['mainWindow', 'dshView', 'settingsWindow']) {
    assert.doesNotMatch(
      registration,
      new RegExp(`const\\s+\\w+\\s*=\\s*state\\.windows\\.${name}\\b`),
      `installShellIpc 中把 state.windows.${name} 存进了局部变量：应在 handler 内部按需读取。`,
    )
  }
})

test('store 仍是可变属性容器（不可改为 getter 或构造时快照）', async () => {
  const storeSource = await readFile(new URL('../../src/desktop/desktop-state.ts', import.meta.url), 'utf8')
  // Getters would break both late binding and the `??=` idiom used on mainWindow.
  assert.doesNotMatch(storeSource, /^\s+get [a-z]\w*\s*\(/m, 'store 不应使用 getter：会破坏晚绑定与 ??=')
  // Only the group references are readonly; the fields must stay writable.
  assert.match(storeSource, /readonly windows: WindowsState/, '分组引用应保持 readonly')
  assert.match(storeSource, /^\s+mainWindow: BrowserWindow \| undefined\s*$/m, 'mainWindow 字段必须是可写属性')
})
