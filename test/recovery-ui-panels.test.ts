import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Guards for the recovery page.
 *
 * The page is now a SINGLE-FILE port of dsh-desktop's `native-ui/recovery/App.tsx`
 * (same six tabs, same panel anatomy), so these guards inspect one file plus the copy
 * table instead of a panels/ directory. They assert the properties that fail
 * SILENTLY — a blank window or a missing capability, with no error anywhere:
 *
 *   1. The entry point renders the real `App`, not a preview harness left behind.
 *   2. Mounting waits for the DOM (a classic script in `<head>` runs before `<body>`).
 *   3. The page reaches the main process only through the typed API wrapper.
 *   4. Failures are surfaced rather than swallowed.
 *   5. Chinese and English copy stay structurally identical.
 */
const projectRoot = join(import.meta.dirname, '..', '..')
const uiDir = join(projectRoot, 'frontend', 'recovery')

function read(relative: string): string {
  return readFileSync(join(uiDir, relative), 'utf8')
}

test('入口渲染真正的 App（而不是遗留的预览壳）', () => {
  const main = read('main.tsx')
  assert.match(main, /import \{ App \} from '\.\/App'/, '入口应导入真正的 App')
  assert.match(main, /render\(<StrictMode><App \/><\/StrictMode>\)/, '入口应渲染 App')
  // A preview harness wired in as the entry point would ship debugging UI to users.
  assert.doesNotMatch(main, /PrimitivesShowcase|PanelsPreview/, '入口不应渲染调试用预览页')
})

test('入口在 DOM 就绪后挂载（经典脚本在 head 中早于 body 执行）', () => {
  const main = read('main.tsx')
  assert.match(main, /DOMContentLoaded|readyState/, '挂载必须等待 DOM 就绪')
})

test('页面只通过 recovery-api 访问主进程（不直接碰 window.dshRecovery）', () => {
  for (const file of ['App.tsx', 'components/RecoveryWindowPrimitives.tsx']) {
    const source = read(file)
    assert.doesNotMatch(
      source,
      /window\.dshRecovery/,
      `${file} 不应直接使用 window.dshRecovery —— 应经 recovery-api 层（那里处理桥接缺失）`,
    )
    assert.doesNotMatch(source, /from 'electron'/, `${file} 不应引用 electron`)
    assert.doesNotMatch(source, /from 'node:/, `${file} 不应引用 node: 模块`)
  }
})

test('App 通过 recovery-api 调用，而非直接使用 window', () => {
  const app = read('App.tsx')
  assert.match(app, /from '\.\/recovery-api\.js'/, 'App 应导入 recovery-api')
  assert.doesNotMatch(app, /window\.dshRecovery/, 'App 不应直接触碰 preload 对象')
})

test('App 处理桥接缺失（页面在应用外打开时给出明确说明）', () => {
  const app = read('App.tsx')
  // Without this, opening the page in a browser (a normal development step) shows an
  // empty shell with no explanation.
  assert.match(app, /hasBridge/, 'App 应检查桥接是否可用')
  const copy = read('recovery-copy.ts')
  assert.match(copy, /无法读取恢复信息|Recovery information could not be read/, '桥接缺失时应给出明确说明')
})

test('破坏性操作的失败会显示出来（不静默）', () => {
  const app = read('App.tsx')
  // A recovery page whose button silently does nothing is worse than one that reports
  // an error: the user has no other way to observe what happened.
  assert.match(app, /catch/, '操作失败必须被捕获')
  assert.match(app, /setNotice|RecoveryNoticeSurface/, '失败必须呈现给用户')
})

test('忙碌状态会禁用交互（避免并发触发恢复操作）', () => {
  const app = read('App.tsx')
  assert.match(app, /busy/, '应有 busy 状态')
  // Two concurrent recovery actions would apply overlapping configuration changes.
  assert.match(app, /disabled=\{busy\}/, '忙碌时应禁用按钮')
  assert.match(app, /pointer-events-none/, '忙碌时应同时禁用指针交互')
})

test('回滚面板区分空槽与可用槽（空槽不显示操作）', () => {
  const app = read('App.tsx')
  assert.match(app, /checkpoint\.status === 'available'|const available = checkpoint\.status/, '应按状态区分')
  // Offering "roll back" on an empty slot would promise something impossible.
  assert.match(app, /noHealthyStartup|emptySlot/, '空槽应有明确文案')
})

test('六个标签页与参考实现一致（含数据管理）', () => {
  const app = read('App.tsx')
  const copy = read('recovery-copy.ts')
  // Tab order is part of the 1:1 parity contract, not an implementation detail.
  const order = ['quick', 'plugins', 'rollback', 'profiles', 'data', 'diagnostics']
  let cursor = -1
  for (const tab of order) {
    const at = app.indexOf(`<TabsTrigger value="${tab}"`)
    assert.ok(at > cursor, `标签 ${tab} 应存在且顺序正确`)
    cursor = at
  }
  for (const label of ['快速恢复', '插件管理', '回滚', '切换 Profile', '重置与数据管理', '诊断']) {
    assert.ok(copy.includes(label), `文案表应含标签「${label}」`)
  }
})

test('中英文案表结构一致（缺翻译应是类型错误而非静默英文）', () => {
  const copy = read('recovery-copy.ts')
  // Both tables are typed as RecoveryCopy, so a missing key fails to compile; this
  // guards the weaker failure mode where a key exists but was left in the wrong locale.
  const zhStart = copy.indexOf('const ZH: RecoveryCopy = {')
  const enStart = copy.indexOf('const EN: RecoveryCopy = {')
  assert.ok(zhStart > 0 && enStart > zhStart, '两张文案表都应存在')
  const keys = (block: string): string[] =>
    [...block.matchAll(/^ {2}(\w+):/gm)].map(match => match[1]!).sort()
  const zh = keys(copy.slice(zhStart, enStart))
  const en = keys(copy.slice(enStart))
  assert.ok(zh.length > 50, `中文文案条目过少（${zh.length}）`)
  assert.deepEqual(zh, en, '中英两张表的键必须完全一致')
})

test('恢复页只列出当前 profile 的槽位（与参考实现一致）', () => {
  const app = read('App.tsx')
  const copy = read('recovery-copy.ts')
  // dsh-desktop stores slots per profile and shows the ACTIVE profile's three; the
  // profile is stated once in the reason card rather than repeated on every slot card.
  assert.match(app, /copy\.currentProfile/, '原因卡应显示当前 Profile')
  assert.match(copy, /当前 Profile|Current Profile/, '文案表应有「当前 Profile」')
  assert.doesNotMatch(app, /slot\.profileName\}/, '槽位卡不应重复 profile 名（参考实现不重复）')
})
