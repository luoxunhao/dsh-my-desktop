import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Guards for the shell windows' build chain.
 *
 * The title bar, about, shortcuts, settings and startup windows became React
 * surfaces built by Vite. They share exactly the two invisible failure modes the
 * recovery page has (see `recovery-ui-build.test.ts`), plus two of their own:
 *
 * 1. **The build is not part of `build:all`.** `test` runs `build:all`, so a
 *    missing step means the artifacts do not exist on a clean clone.
 * 2. **The emitted document cannot load over `file://`.** A
 *    `<script type="module">` or a `crossorigin` attribute is silently refused,
 *    and the window renders EMPTY with clean-looking HTML and no console error.
 * 3. **The relative asset paths have no files behind them.** The documents load
 *    `shell-icons/*.svg` and `icon.png` by relative URL at runtime (they appear
 *    in JSX, so Vite does not rewrite them). Because the documents are served
 *    from `dist/shell-ui/`, those files must be copied INSIDE that directory —
 *    the copies at the `resources/` root do not resolve. Missing them means blank
 *    icons in a window that otherwise looks fine.
 * 4. **The five windows are built by five Vite runs.** Vite 8 rejects
 *    `format: 'iife'` with multiple inputs, so the one-build-per-window shape is
 *    load-bearing and a regression to a single build would fail outright.
 *
 * None of these are caught by tsc or by a behavioural test, so they are asserted
 * directly here.
 */
const projectRoot = join(import.meta.dirname, '..', '..')

const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  build: { extraResources: Array<{ from?: string, to?: string }> }
}

/** Every window entry, matching `SHELL_ENTRIES` in vite.config.ts. */
const WINDOWS = ['shell', 'about', 'shortcuts', 'settings', 'startup'] as const

/** Documents the main process loads directly, and their resolver names. */
const DOCUMENTS = ['shell.html', 'about.html', 'shortcuts.html', 'settings.html', 'startup.html'] as const

/** Files referenced by relative URL from inside the built documents. */
const RELATIVE_ASSETS = ['shell-icons', 'icon.png'] as const

test('build:all 包含外壳窗口构建（否则干净 clone 上产物缺失）', () => {
  const buildAll = packageJson.scripts['build:all']
  assert.ok(buildAll !== undefined, '缺少 build:all')
  assert.match(buildAll, /build:shell-ui/, 'build:all 必须包含 build:shell-ui')

  assert.match(packageJson.scripts.test!, /build:all/)
  assert.ok(packageJson.scripts['build:shell-ui'] !== undefined, '缺少 build:shell-ui 脚本')
  assert.ok(packageJson.scripts['check:shell-ui'] !== undefined, '缺少 check:shell-ui 脚本')
})

test('build:all 同时保留恢复页与插件构建', () => {
  // The shell work must not have displaced the two build steps that were already
  // load-bearing: the recovery page's artifacts and the settings plugin.
  const buildAll = packageJson.scripts['build:all']!
  assert.match(buildAll, /build:plugin/, 'build:all 必须包含 build:plugin')
  assert.match(buildAll, /build:recovery-ui/, 'build:all 必须包含 build:recovery-ui')
  assert.match(buildAll, /build:flat/, 'build:all 必须包含 build:flat')
})

test('外壳窗口产物目录进入打包资源清单', () => {
  const entry = packageJson.build.extraResources.find(item => item.to === 'shell-ui')
  assert.ok(entry !== undefined, 'extraResources 缺少 shell-ui')
  assert.equal(entry.from, 'dist/shell-ui')

  /*
   * The five loose HTML files must NOT still be listed. Shipping them alongside
   * the built ones would leave two copies of each page in the package, and the
   * resolver prefers the packaged `shell-ui/` copy — so the stale ones would be
   * dead weight that silently shadows nothing, until someone edits them and
   * wonders why the app ignores the change.
   */
  for (const document of DOCUMENTS) {
    const stale = packageJson.build.extraResources.find(item => item.to === document)
    assert.equal(stale, undefined, `extraResources 不应再单独打包 ${document}`)
  }
})

test('构建产物存在（install 后由 build:all 生成）', () => {
  for (const document of DOCUMENTS) {
    const html = join(projectRoot, 'dist', 'shell-ui', document)
    assert.equal(existsSync(html), true, `缺少构建产物：${html} —— 请先运行 pnpm run build:shell-ui`)
  }
})

test('产物在 file:// 下可加载：无 module 类型、无 crossorigin、相对路径', () => {
  for (const document of DOCUMENTS) {
    const html = readFileSync(join(projectRoot, 'dist', 'shell-ui', document), 'utf8')

    // A module script is REFUSED over file:// with an opaque origin. The document
    // still loads, so the only symptom is an empty window.
    assert.doesNotMatch(html, /<script[^>]*type="module"/, `${document}: 脚本必须是经典脚本`)
    assert.doesNotMatch(html, /\scrossorigin(?=[\s>])/, `${document}: crossorigin 会让 file:// 请求变成 CORS`)
    assert.doesNotMatch(html, /src="\/[^"]/, `${document}: 资源必须是相对路径`)
    assert.match(html, /Content-Security-Policy/, `${document}: 产物必须保留 CSP`)
    assert.match(html, /connect-src 'none'/, `${document}: CSP 应保持 connect-src none`)
    // Every window draws from `shell-icons/` or `icon.png` at runtime.
    assert.match(html, /img-src 'self'/, `${document}: CSP 需允许本地图片`)
  }
})

test('产物是经典脚本包（IIFE）：无顶层 import/export', () => {
  for (const name of WINDOWS) {
    const bundlePath = join(projectRoot, 'dist', 'shell-ui', 'assets', `${name}.js`)
    assert.equal(existsSync(bundlePath), true, `缺少 bundle：${bundlePath}`)
    const bundle = readFileSync(bundlePath, 'utf8')
    assert.doesNotMatch(bundle, /^\s*(import|export)\s/m, `${name}: 经典脚本包不应含顶层 import/export`)
    assert.match(bundle, /\(function\s*\(\)|\(function\(\)/, `${name}: 应为 IIFE 形式`)
  }
})

test('相对路径引用的运行期资源已随产物复制', () => {
  /*
   * These are copied by `scripts/build-shell-ui.mjs`, not by Vite, because they
   * are referenced from JSX/HTML as plain runtime strings. Asserting on SIZE as
   * well as existence catches the failure actually hit while building this: Vite
   * created 1-byte placeholder files for the paths it saw in the HTML, so the
   * icons existed but were empty and every glyph rendered blank.
   */
  for (const asset of RELATIVE_ASSETS) {
    const copied = join(projectRoot, 'dist', 'shell-ui', asset)
    assert.equal(existsSync(copied), true, `缺少运行期资源：${copied}`)
  }

  const iconsDir = join(projectRoot, 'dist', 'shell-ui', 'shell-icons')
  const referenced = new Set<string>()
  for (const name of WINDOWS) {
    const source = readFileSync(join(projectRoot, 'dist', 'shell-ui', 'assets', `${name}.js`), 'utf8')
    for (const match of source.matchAll(/shell-icons\/([\w.-]+\.svg)/g)) referenced.add(match[1]!)
  }
  assert.ok(referenced.size > 0, '至少应引用一个 shell 图标')
  for (const icon of referenced) {
    const path = join(iconsDir, icon)
    assert.equal(existsSync(path), true, `引用了但未复制：shell-icons/${icon}`)
    const stats = readFileSync(path, 'utf8')
    assert.ok(stats.length > 100, `shell-icons/${icon} 内容疑似被截断（${stats.length} 字节）`)
    assert.match(stats, /<svg/, `shell-icons/${icon} 不是有效 SVG`)
  }
})

test('五个窗口各自独立构建（IIFE 不接受多输入）', () => {
  /*
   * Vite 8 bundles with Rolldown and rejects `format: 'iife'` with more than one
   * input, so the one-build-per-window shape is a constraint, not a preference.
   * If someone "simplifies" this back to a multi-entry object, the build fails —
   * this asserts the design so the failure is understood rather than reverted.
   */
  const buildScript = readFileSync(join(projectRoot, 'scripts', 'build-shell-ui.mjs'), 'utf8')
  assert.match(buildScript, /DSH_SHELL_ENTRY/, '构建脚本必须按入口逐个调用 vite')
  /*
   * The entry names are the BUILD names, which differ from the document names for
   * the title bar: its document is `shell.html` but its entry key is `index`.
   * Assert the exact list from `build-shell-ui.mjs` so the two cannot drift.
   */
  assert.match(buildScript, /const ENTRIES = \['index', 'about', 'shortcuts', 'settings', 'startup'\]/, '构建入口列表与预期不符')

  const config = readFileSync(join(projectRoot, 'vite.config.ts'), 'utf8')
  assert.match(config, /format: 'iife'/, '必须输出经典脚本')
  // Assert on the OPTION, not the bare word: the config's comment explains why
  // `inlineDynamicImports` is unavailable, and that explanation must be allowed
  // to name it.
  assert.doesNotMatch(config, /^\s*inlineDynamicImports:/m, 'Rolldown 无此选项，多输入下会导致构建失败')
})

test('源码挂载在 DOM 就绪之后（经典脚本在 head 中会早于 body 执行）', () => {
  // A classic script in <head> runs before <body> exists, so an unguarded
  // getElementById('root') returns null and the window throws.
  for (const name of WINDOWS) {
    const entry = name === 'shell' ? 'shell-entry.tsx' : `${name}-entry.tsx`
    const source = readFileSync(join(projectRoot, 'src', 'shell-ui', entry), 'utf8')
    assert.match(source, /DOMContentLoaded|readyState/, `${entry}: 挂载必须等待 DOM 就绪`)
  }
})

test('标题栏按钮取色与工具图标同源，且按钮区无独立底色', () => {
  /*
   * This asserts the COLOR-MATCHING contract, which the source alone cannot
   * prove: the bootstrap value, the CSS custom property that carries it, and the
   * rule that consumes it are three separate places that must line up.
   *
   * The failure mode is silent. A name mismatch does not throw — the declaration
   * lands on the element, nothing reads it, and the CSS falls back to its
   * dark-theme default. That is exactly what shipped in the first cut:
   * `ShellBar.tsx` published `--titlebar-symbol` while `bar.css` consumed
   * `--titlebar-fg`, so the light theme drew near-white caption glyphs on a white
   * bar. Checking the name in both files is what makes it loud.
   */
  const bar = readFileSync(join(projectRoot, 'src', 'shell-ui', 'ShellBar.tsx'), 'utf8')
  const css = readFileSync(join(projectRoot, 'src', 'shell-ui', 'styles', 'bar.css'), 'utf8')

  const published = /\[?'(--titlebar-[\w-]+)'/.exec(bar)?.[1]
  const consumed = /\.caption-button \{ color: var\((--titlebar-[\w-]+)\); \}/.exec(css)?.[1]

  assert.ok(published !== undefined, '标题栏组件必须发布取色变量')
  assert.ok(consumed !== undefined, 'CSS 必须用该变量给按钮取色')
  assert.equal(published, consumed, `发布的变量 ${published} 与消费的变量 ${consumed} 不一致`)

  // The strip must stay transparent so the bar's gradient is continuous; a solid
  // fill here is precisely what the native overlay did, and what created the seam.
  assert.match(css, /\.caption-buttons \{[\s\S]*?\}/, '缺少按钮区样式')
  assert.doesNotMatch(/\.caption-buttons \{[\s\S]*?\}/.exec(css)![0], /background:/, '按钮区不应有独立底色')
})

test('标题栏按钮由渲染进程绘制（消除两套颜色来源）', () => {
  /*
   * The reported defect: the native caption-button overlay could only paint a
   * SOLID color, so it could not follow the bar's gradient. The result was a
   * visible seam against the renderer-drawn icons beside it, plus a jump from
   * 72%-black HTML glyphs to a 100%-black native one.
   *
   * The fix removes the second color authority entirely. This asserts BOTH
   * halves: the native overlay is gone, and the renderer draws the buttons.
   */
  const registry = readFileSync(join(projectRoot, 'src', 'desktop', 'window-registry.ts'), 'utf8')
  assert.doesNotMatch(registry, /titleBarOverlay:\s*\{/, '不应再使用原生标题栏覆盖层')

  const broadcast = readFileSync(join(projectRoot, 'src', 'desktop', 'shell-broadcast-service.ts'), 'utf8')
  assert.doesNotMatch(broadcast, /\.setTitleBarOverlay\(/, '不应再重绘原生覆盖层')

  const controls = readFileSync(join(projectRoot, 'src', 'shell-ui', 'WindowControls.tsx'), 'utf8')
  assert.match(controls, /windowControl\(/, '必须经桥接通道发送窗口命令')

  // The bar's icons and the caption glyphs must read the SAME custom property,
  // which is what makes the seam structurally impossible rather than merely fixed.
  const bar = readFileSync(join(projectRoot, 'src', 'shell-ui', 'styles', 'bar.css'), 'utf8')
  assert.match(bar, /\.caption-button \{ color: var\(--titlebar-fg\); \}/, '标题栏按钮必须与工具图标同源取色')

  // And the value is shipped from the main process, so the two cannot drift.
  const contract = readFileSync(join(projectRoot, 'src', 'desktop', 'shell-contract.ts'), 'utf8')
  assert.match(contract, /readonly titleBar: ShellTitleBarPalette/, 'bootstrap 必须携带标题栏配色')
})

test('自绘窗口按钮的 IPC 受渲染进程身份门禁', () => {
  /*
   * Self-drawing the buttons required a NEW IPC channel that can minimise,
   * maximise and close a window. That is a security-relevant addition, so the
   * gate is asserted directly: `dsh` runs remote content and must never be able
   * to close or minimise its host window.
   */
  const policy = readFileSync(join(projectRoot, 'src', 'desktop', 'shell-ipc-policy.ts'), 'utf8')
  assert.match(policy, /export function mayControlWindow\(kind: ShellRendererKind\): boolean \{[\s\S]*?kind === 'main' \|\| kind === 'about' \|\| kind === 'shortcuts'/)

  const registrar = readFileSync(join(projectRoot, 'src', 'desktop', 'shell-ipc-registrar.ts'), 'utf8')
  // The target window is resolved from the SENDER, never from a stored handle:
  // about/shortcuts are transient dialogs, so "the main window" would be wrong.
  assert.match(registrar, /BrowserWindow\.fromWebContents\(event\.sender\)/, '必须按发送方解析目标窗口')
  assert.match(registrar, /mayControlWindow\(deps\.rendererKind\(event\.sender\)\)/, '必须做身份门禁')

  const preload = readFileSync(join(projectRoot, 'src', 'shell-preload.cts'), 'utf8')
  assert.match(preload, /windowControl:/, '预加载必须暴露 windowControl')
  assert.match(preload, /getWindowState:/, '预加载必须暴露 getWindowState')
})
