import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Guard for the DEV-mode module paths.
 *
 * WHY THIS EXISTS
 * ---------------
 * A real bug shipped and went unnoticed for four tickets: `main.ts` dynamically
 * imported the DSH process module with a ternary
 *
 *     await import(app.isPackaged ? <resources path> : './dsh-process.js')
 *
 * The dev branch kept the pre-layering path after `dsh-process.ts` moved into
 * `src/bridge/`, so `pnpm start` died with
 *
 *     ERR_MODULE_NOT_FOUND: Cannot find module '.../dist/src/dsh-process.js'
 *
 * Nothing caught it because every test and every packaged build takes the OTHER
 * branch: packaged mode reads `resources/desktop-bridge/…`, which did exist. Only
 * running the app from source exposes it — so this test checks the dev branch
 * by resolving it against the real `dist/` tree.
 */
const projectRoot = join(import.meta.dirname, '..', '..')

test('main.ts 的动态 import：dev 分支必须指向真实存在的编译产物', async () => {
  const source = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')

  // The dynamic import for the DSH process module is the only one that branches
  // on `isPackaged`; find the dev half of that ternary.
  const match = /await import\(app\.isPackaged\s*\?\s*[^:]+:\s*'([^']+)'\)/.exec(source)
  assert.ok(match !== null, '未找到 app.isPackaged 的动态 import 三元表达式 —— 护栏失效，请更新此测试')
  const devSpecifier = match[1]!
  assert.ok(devSpecifier.startsWith('./'), `dev 分支应为相对路径: ${devSpecifier}`)

  // Resolve it the way Node will: relative to the compiled main.js in dist/src/.
  const resolved = join(projectRoot, 'dist', 'src', devSpecifier.replace(/^\.\//, ''))
  assert.equal(
    existsSync(resolved),
    true,
    `dev 分支的 import 指向不存在的文件：${devSpecifier}（解析为 ${resolved}）。`
    + '分层重构后该文件可能已移入子目录 —— 请同步更新路径。',
  )
})

test('dev 模式依赖的其它路径也必须在 dist 中存在', () => {
  // These are the paths resolvePreload / resolveDshBootstrap / bridge resolution
  // produce for a dev run. A layering change that misses any of them breaks
  // `pnpm start` while leaving packaged builds green.
  const devPaths = [
    ['dist', 'src', 'shell-preload.cjs'],
    ['dist', 'src', 'dsh-view-preload.cjs'],
    ['dist', 'src', 'recovery-preload.cjs'],
    ['dist', 'src', 'runtime', 'dsh-bootstrap.mjs'],
    ['dist', 'bridge-flat', 'desktop-host.js'],
    ['dist', 'src', 'main.js'],
  ]
  for (const parts of devPaths) {
    const full = join(projectRoot, ...parts)
    assert.equal(existsSync(full), true, `dev 模式缺少构建产物：${parts.join('/')}`)
  }
})
