import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { DESKTOP_THEME_PALETTES, normalizeDesktopThemeSnapshot } from '../src/desktop/desktop-theme.js'

test('桌面主题只接受 light/dark 解析结果和内置偏好', () => {
  assert.deepEqual(normalizeDesktopThemeSnapshot('light'), { colorScheme: 'light' })
  assert.deepEqual(normalizeDesktopThemeSnapshot({ colorScheme: 'dark', preference: 'system' }), { colorScheme: 'dark', preference: 'system' })
  assert.deepEqual(normalizeDesktopThemeSnapshot({ colorScheme: 'light', preference: 'custom' }), { colorScheme: 'light' })
  assert.equal(normalizeDesktopThemeSnapshot({ colorScheme: 'sepia', preference: 'dark' }), undefined)
})

test('浅色和深色桌面调色板提供所有原生窗口背景', () => {
  assert.equal(DESKTOP_THEME_PALETTES.light.settingsBackground, '#ffffff')
  assert.equal(DESKTOP_THEME_PALETTES.dark.shortcutsBackground, '#262827')
  // Every palette slot must be a real color; a missing one paints the window in
  // the wrong theme before the renderer's first paint.
  for (const scheme of ['light', 'dark'] as const) {
    for (const [key, value] of Object.entries(DESKTOP_THEME_PALETTES[scheme])) {
      assert.match(value, /^#[0-9a-f]{6}$/i, `${scheme}.${key} 不是有效颜色：${value}`)
    }
  }
})

test('标题栏预绘制背景与外壳渐变的右端一致', () => {
  /*
   * `titleBarBackground` paints the window before the renderer's first paint, so
   * it must equal the color the bar ACTUALLY has where the caption buttons sit —
   * the right-hand gradient stop. A mismatch is a visible flash on startup.
   *
   * This is the invariant behind the reported defect. The old values (`#f1f4f3`
   * light, `#1f2020` dark) were chosen for Electron's native caption overlay,
   * which could only paint a solid color; against the renderer-drawn bar they
   * produced a seam. Asserting the GRADIENT STOP rather than a frozen hex is what
   * lets the colors be corrected without the test pinning the bug in place.
   */
  const projectRoot = join(import.meta.dirname, '..', '..')
  const bar = readFileSync(join(projectRoot, 'src', 'shell-ui', 'styles', 'bar.css'), 'utf8')

  const darkStop = bar.match(/linear-gradient\(180deg, #222423 0%, (#[0-9a-f]{6}) 100%\)/i)?.[1]
  const lightStop = bar.match(/linear-gradient\(180deg, #ffffff 0%, (#[0-9a-f]{6}) 100%\)/i)?.[1]

  assert.ok(darkStop !== undefined, '未找到深色标题栏渐变终点')
  assert.ok(lightStop !== undefined, '未找到浅色标题栏渐变终点')
  assert.equal(DESKTOP_THEME_PALETTES.dark.titleBarBackground, darkStop)
  assert.equal(DESKTOP_THEME_PALETTES.light.titleBarBackground, lightStop)
})
