import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * The recovery IPC contract exists in TWO places and cannot be shared.
 *
 * `recovery-preload.cts` is a CommonJS preload loaded in a sandboxed renderer; it
 * cannot import from `src/main.ts`. So the channel names are duplicated, and a
 * channel renamed on one side only fails at RUNTIME with "no handler registered for
 * …" — the page's button simply stops working, with nothing in the type system or
 * the build to catch it.
 *
 * This test compares the two lists directly, so the duplication cannot drift.
 */
const projectRoot = join(import.meta.dirname, '..', '..')

/**
 * Pull the KEY → CHANNEL pairs out of a `const NAME = { key: 'value', … } as const`.
 *
 * Comparing keys alone is not enough: the drift that actually breaks the app is a
 * channel STRING renamed on one side, which leaves both lists with identical keys.
 * That was verified by mutation — a key-only comparison passed while the preload
 * pointed at a channel name the main process never registered.
 */
function channelEntries(source: string, constName: string): Array<[string, string]> {
  const start = source.indexOf(`const ${constName} = {`)
  assert.ok(start >= 0, `未找到 ${constName}`)
  const end = source.indexOf('} as const', start)
  assert.ok(end > start, `${constName} 未正常结束`)
  const body = source.slice(start, end)
  return [...body.matchAll(/^\s{2}(\w+):\s*'([^']+)'/gm)]
    .map(match => [match[1]!, match[2]!] as [string, string])
    .sort((left, right) => left[0].localeCompare(right[0]))
}

const mainSource = readFileSync(join(projectRoot, 'src', 'main.ts'), 'utf8')
const preloadSource = readFileSync(join(projectRoot, 'src', 'recovery-preload.cts'), 'utf8')

test('主进程与 preload 的恢复通道清单必须完全一致（含通道名）', () => {
  const main = channelEntries(mainSource, 'RECOVERY_IPC')
  const preload = channelEntries(preloadSource, 'RECOVERY_IPC')
  assert.ok(main.length > 0, '应解析出通道')
  assert.deepEqual(
    preload,
    main,
    '恢复 IPC 通道在两个文件中不一致 —— 只改一侧会导致运行时「没有注册处理程序」',
  )
})

test('每个通道都注册了处理程序，且每个处理程序都有通道', () => {
  // Catches a channel added to the contract but never handled (or vice versa).
  for (const [key] of channelEntries(mainSource, 'RECOVERY_IPC')) {
    assert.match(
      mainSource,
      new RegExp(`ipcMain\\.handle\\(RECOVERY_IPC\\.${key}\\b`),
      `通道 ${key} 没有对应的 ipcMain.handle`,
    )
  }
})

test('每个通道都被 preload 暴露给页面', () => {
  // A handler the page cannot reach is dead code; a page call with no exposure
  // throws "is not a function" rather than reporting the real problem.
  for (const [key] of channelEntries(preloadSource, 'RECOVERY_IPC')) {
    assert.match(
      preloadSource,
      new RegExp(`ipcRenderer\\.invoke\\(RECOVERY_IPC\\.${key}\\b`),
      `通道 ${key} 未通过 preload 暴露`,
    )
  }
})

test('恢复通道都带 dsh-recovery: 前缀', () => {
  for (const [key, channel] of channelEntries(mainSource, 'RECOVERY_IPC')) {
    assert.match(channel, /^dsh-recovery:/, `通道 ${key} 的名字缺少前缀：${channel}`)
  }
})
