import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Guards for the recovery page's build chain.
 *
 * WHY THIS EXISTS
 * ---------------
 * The recovery page is the first part of the launcher with a BUILD STEP. Two
 * failure modes are invisible until a user hits them:
 *
 * 1. **The build is not part of `build:all`.** `test` runs `build:all`, so a
 *    missing step means the artifacts do not exist on a clean clone — exactly the
 *    mistake ticket 02 made with `build:flat`, which turned a green suite red for
 *    everyone but the person who had built locally.
 * 2. **The emitted document cannot load over `file://`.** A `<script type="module">`
 *    or a `crossorigin` attribute is silently refused by the browser: the document
 *    loads, the script never runs, and the window renders EMPTY with clean-looking
 *    HTML and no console error. This was hit for real while building this feature.
 *
 * Neither is caught by tsc or by any behavioural test, so they are asserted directly
 * here — the same approach `dev-mode-paths.test.ts` takes for the dev paths.
 */
const projectRoot = join(import.meta.dirname, '..', '..')

const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  build: { extraResources: Array<{ from?: string, to?: string }> }
}

test('build:all 包含恢复页构建（否则干净 clone 上产物缺失）', () => {
  const buildAll = packageJson.scripts['build:all']
  assert.ok(buildAll !== undefined, '缺少 build:all')
  assert.match(buildAll, /build:recovery-ui/, 'build:all 必须包含 build:recovery-ui')

  // And `test` must keep going through build:all — that is what makes the wiring
  // above load-bearing.
  assert.match(packageJson.scripts.test!, /build:all/)
  assert.ok(packageJson.scripts['build:recovery-ui'] !== undefined, '缺少 build:recovery-ui 脚本')
})

test('恢复页产物目录进入打包资源清单', () => {
  const entry = packageJson.build.extraResources.find(item => item.to === 'recovery-ui')
  assert.ok(entry !== undefined, 'extraResources 缺少 recovery-ui')
  assert.equal(entry.from, 'dist/recovery-ui')
})

test('构建产物存在（install 后由 build:all 生成）', () => {
  const html = join(projectRoot, 'dist', 'recovery-ui', 'index.html')
  assert.equal(existsSync(html), true, `缺少构建产物：${html} —— 请先运行 pnpm run build:recovery-ui`)
})

test('产物在 file:// 下可加载：无 module 类型、无 crossorigin', () => {
  const html = readFileSync(join(projectRoot, 'dist', 'recovery-ui', 'index.html'), 'utf8')

  // A module script is REFUSED over file:// with an opaque origin. The document
  // still loads, so the only symptom is an empty window.
  assert.doesNotMatch(html, /<script[^>]*type="module"/, '脚本必须是经典脚本，否则 file:// 下不会执行')
  assert.doesNotMatch(html, /\scrossorigin(?=[\s>])/, 'crossorigin 会让 file:// 请求变成 CORS 并被拒')

  // Relative asset URLs are required: absolute ones resolve to the filesystem root.
  assert.doesNotMatch(html, /src="\/[^"]/, '资源必须是相对路径')
  assert.match(html, /src="\.\/assets\//, '应引用相对资源路径')

  // The strict CSP must survive the build; it is a security property of the page.
  assert.match(html, /Content-Security-Policy/, '产物必须保留 CSP')
  assert.match(html, /connect-src 'none'/, 'CSP 应保持最严的 connect-src none')
})

test('产物是经典脚本包（IIFE）：无顶层 import/export', () => {
  const assets = join(projectRoot, 'dist', 'recovery-ui', 'assets')
  assert.equal(existsSync(assets), true)
  // The bundle name is hashed only if configured otherwise; assert on whatever is there.
  const files = readFileSync(join(projectRoot, 'dist', 'recovery-ui', 'index.html'), 'utf8')
    .match(/assets\/[^"']+\.js/)
  assert.ok(files !== null, '产物 HTML 必须引用一个 JS bundle')
  const bundle = readFileSync(join(projectRoot, 'dist', 'recovery-ui', files[0]!), 'utf8')
  assert.doesNotMatch(bundle, /^\s*(import|export)\s/m, '经典脚本包不应含顶层 import/export')
  assert.match(bundle, /\(function\s*\(\)|\(function\(\)/, '应为 IIFE 形式')
})

test('源码挂载在 DOM 就绪之后（经典脚本在 head 中会早于 body 执行）', () => {
  // A classic script in <head> runs before <body> exists, so an unguarded
  // getElementById('root') returns null and the page throws — which is exactly what
  // happened before this guard was added.
  const source = readFileSync(join(projectRoot, 'src', 'recovery-ui', 'main.tsx'), 'utf8')
  assert.match(source, /DOMContentLoaded|readyState/, '挂载必须等待 DOM 就绪')
})
