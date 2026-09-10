import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Guards for the recovery page's panels and entry point.
 *
 * The UI cannot be exercised headlessly (this repo has no DOM test stack, by
 * decision), so what is asserted here are the properties that fail SILENTLY — the
 * ones that produce a blank window or a missing feature rather than an error:
 *
 *   1. The entry point must render the real `App`, not a preview harness left behind.
 *   2. Mounting must wait for the DOM (classic script in `<head>` runs before `<body>`).
 *   3. Panels must reach the main process only through the typed API wrapper, so a
 *      panel cannot invent an IPC call the preload does not expose.
 */
const projectRoot = join(import.meta.dirname, '..', '..')
const uiDir = join(projectRoot, 'src', 'recovery-ui')

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

test('面板只通过 recovery-api 访问主进程（不直接碰 window.dshRecovery）', () => {
  const panels = ['ReasonCard', 'PluginsPanel', 'RollbackPanel', 'ProfilesPanel', 'DiagnosticsPanel']
    .map(name => ({ name, source: read(join('panels', `${name}.tsx`)) }))
  for (const { name, source } of panels) {
    assert.doesNotMatch(
      source,
      /window\.dshRecovery/,
      `${name} 不应直接使用 window.dshRecovery —— 应经 recovery-api 层（那里有桥接缺失的处理）`,
    )
    assert.doesNotMatch(source, /from 'electron'/, `${name} 不应引用 electron`)
    assert.doesNotMatch(source, /from 'node:/, `${name} 不应引用 node: 模块`)
  }
})

test('App 通过 recovery-api 调用，而非直接使用 window', () => {
  const app = read('App.tsx')
  assert.match(app, /from '\.\/recovery-api'/, 'App 应导入 recovery-api')
  assert.doesNotMatch(app, /window\.dshRecovery/, 'App 不应直接触碰 preload 对象')
})

test('App 处理桥接缺失（页面在应用外打开时给出明确说明）', () => {
  const app = read('App.tsx')
  // Without this, opening the page in a browser (a normal development step) shows an
  // empty shell with no explanation.
  assert.match(app, /hasBridge/, 'App 应检查桥接是否可用')
  assert.match(app, /未运行在应用内|恢复通道不可用/, '桥接缺失时应给出明确说明')
})

test('破坏性操作的失败会显示出来（不静默）', () => {
  const app = read('App.tsx')
  // A recovery page whose button silently does nothing is worse than one that reports
  // an error: the user has no other way to observe what happened.
  assert.match(app, /catch/, '操作失败必须被捕获')
  assert.match(app, /setNotice|Alert/, '失败必须呈现给用户')
})

test('忙碌状态会禁用交互（避免并发触发恢复操作）', () => {
  const app = read('App.tsx')
  assert.match(app, /busy/, '应有 busy 状态')
  // Two concurrent recovery actions would apply overlapping configuration changes.
  assert.match(app, /disabled=\{busy\}/, '忙碌时应禁用按钮')
  assert.match(app, /pointer-events-none/, '忙碌时应同时禁用指针交互')
})

test('回滚面板区分空槽与可用槽（空槽不显示操作）', () => {
  const panel = read(join('panels', 'RollbackPanel.tsx'))
  assert.match(panel, /slot\.status === 'available'/, '应按状态区分')
  // Offering "roll back" on an empty slot would promise something impossible.
  assert.match(panel, /尚未记录任何健康启动|空槽/, '空槽应有明确文案')
})

test('差异信息按需获取，而不是每次渲染都检查', () => {
  const panel = read(join('panels', 'RollbackPanel.tsx'))
  // Inspecting hashes every checkpointed file; doing it for all slots on every render
  // would be wasted work.
  assert.match(panel, /inspection === undefined/, '差异应有"未检查"状态')
})
