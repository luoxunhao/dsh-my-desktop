import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Guards for the UI primitive layer.
 *
 * The components are ported VERBATIM from the reference implementation so the
 * recovery page matches `dsh-desktop` visually. That fidelity is easy to lose
 * silently: a class renamed, a token dropped, or a dark-mode rule switched to
 * `prefers-color-scheme` all still build and render — they just look subtly wrong,
 * and nothing fails.
 *
 * These assertions are deliberately about the properties that would be expensive to
 * rediscover: the token vocabulary the components depend on, and the colour-scheme
 * mechanism (which is where we intentionally differ from the reference).
 */
const projectRoot = join(import.meta.dirname, '..', '..')
const uiDir = join(projectRoot, 'src', 'recovery-ui')

const styles = readFileSync(join(uiDir, 'styles.css'), 'utf8')

/**
 * Colour tokens the theme must define.
 *
 * Tailwind's colour-bearing utilities are matched, then filtered against the word
 * lists below: `bg-transparent`, `border-border` and `bg-clip-padding` all match the
 * prefix pattern but are not theme tokens, and treating them as such would make this
 * test fail for the wrong reason.
 */
const UTILITY_PREFIXES = ['bg', 'text', 'border', 'ring', 'outline', 'fill', 'stroke'] as const
/** Utility keywords that are NOT theme colour tokens. */
const NOT_TOKENS = new Set([
  // Structural / colour keywords.
  'transparent', 'current', 'inherit', 'none',
  // Size and shape scales: `text-sm`, `border-t`, `ring-3`, `text-xs`.
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl',
  // Side and style keywords: `border-t`, `border-border` is a real token but
  // `border-dashed`/`text-left` are not.
  't', 'b', 'l', 'r', 'x', 'y', 'solid', 'dashed', 'dotted', 'left', 'center', 'right',
])

function colorTokensIn(source: string): Set<string> {
  const found = new Set<string>()
  for (const prefix of UTILITY_PREFIXES) {
    // Require a non-word char (or string start) BEFORE the prefix and a colour-shaped
    // name after it. Without the leading guard, `shadow-sm` matches as `bg`-family
    // noise and the test fails for a token nobody used.
    const pattern = new RegExp(`(?:^|[\\s"'\`])${prefix}-([a-z][a-z-]*)(?:/\\d+)?`, 'gm')
    for (const match of source.matchAll(pattern)) {
      const name = match[1]!
      if (NOT_TOKENS.has(name)) continue
      if (name.startsWith('clip')) continue
      found.add(name)
    }
  }
  return found
}

test('组件依赖的每个颜色 token 都在主题里定义', () => {
  // A component using an undefined token renders transparent/grey rather than
  // failing — the classic silent visual regression.
  const used = new Set<string>()
  for (const file of ['button', 'card', 'badge', 'alert', 'tabs']) {
    const source = readFileSync(join(uiDir, 'components', 'ui', `${file}.tsx`), 'utf8')
    for (const token of colorTokensIn(source)) used.add(token)
  }
  assert.ok(used.size >= 8, `解析出的 token 过少（${used.size}），抽取逻辑可能失效`)

  for (const name of used) {
    assert.match(
      styles,
      new RegExp(`--color-${name}:`),
      `组件用到了 --color-${name}，但主题里没有定义`,
    )
  }
})

test('深浅色通过 data-color-scheme 驱动，而不是 prefers-color-scheme', () => {
  // THE intentional difference from the reference. The app follows the user's DSH
  // theme, which can disagree with the OS setting; keying off the OS would make the
  // recovery page disagree with the rest of the app.
  //
  // Assert on RULES, not on the text: the file's comments mention
  // `prefers-color-scheme`, so a plain substring search would fail on its own
  // documentation.
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(withoutComments, /\[data-color-scheme=['"]dark['"]\]/, '缺少 data-color-scheme 深色选择器')
  assert.doesNotMatch(
    withoutComments,
    /@media[^{]*prefers-color-scheme/,
    '不应使用 prefers-color-scheme —— 主题由 DSH 决定，而非操作系统',
  )
})

test('两套配色都定义了同一组 token（避免某色下漏项）', () => {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '')
  const lightStart = withoutComments.indexOf(':root,')
  const darkStart = withoutComments.indexOf(":root[data-color-scheme='dark']")
  assert.ok(lightStart >= 0 && darkStart > lightStart, '未找到两套配色的规则块')

  const tokensOf = (block: string): string[] =>
    [...block.matchAll(/^\s{2}(--[a-z-]+):/gm)].map(match => match[1]!).sort()

  const lightTokens = tokensOf(withoutComments.slice(lightStart, darkStart))
  const darkTokens = tokensOf(withoutComments.slice(darkStart))
  assert.ok(lightTokens.length > 10, `浅色 token 数量异常：${lightTokens.length}`)
  // `--radius` is a shape token set once, not a per-scheme colour.
  const shared = lightTokens.filter(token => token !== '--radius')
  assert.deepEqual(
    shared,
    darkTokens,
    '深浅两套 token 必须一致，否则某个配色下会用到未定义的值',
  )
})

test('cn 使用 tailwind-merge（调用方的类应能覆盖组件默认值）', () => {
  const utils = readFileSync(join(uiDir, 'lib', 'utils.ts'), 'utf8')
  // Without twMerge, `className="px-6"` on a Button would emit both px-3 and px-6
  // and the winner would depend on stylesheet order rather than intent.
  assert.match(utils, /twMerge/)
  assert.match(utils, /clsx/)
})

test('原语不直接依赖 Node 或 Electron API（渲染层是沙箱化的）', () => {
  for (const file of ['button', 'card', 'badge', 'alert', 'tabs']) {
    const source = readFileSync(join(uiDir, 'components', 'ui', `${file}.tsx`), 'utf8')
    assert.doesNotMatch(source, /from 'node:/, `${file} 不应引用 node: 模块`)
    assert.doesNotMatch(source, /from 'electron'/, `${file} 不应引用 electron`)
  }
})
