/**
 * Window-material resolution.
 *
 * The material path is split so that this half stays pure and Electron-free, which
 * is what makes it testable: the window registry only spreads `options` into the
 * constructor and forwards `effective` to the renderer.
 *
 * THE INVARIANT UNDER TEST
 * ------------------------
 * `effective` and `options` must NEVER disagree. The renderer turns its own
 * surfaces transparent whenever it is told a glass material is in force, so if
 * `effective` claimed a material while no material was actually painted, the page
 * would go see-through over nothing. Every case below therefore also asserts the
 * pairing, not just the individual values.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { APPEARANCE_MATERIALS } from '../src/profiles/appearance-preference.js'
import { resolveWindowMaterial } from '../src/desktop/window-material.js'

const GLASS = ['mica', 'acrylic'] as const

test('Windows 上 mica / acrylic 会真的设置系统材质并放行透明底', () => {
  for (const material of GLASS) {
    const resolved = resolveWindowMaterial(material, 'win32')
    assert.equal(resolved.effective, material, material)
    assert.equal(resolved.options.backgroundMaterial, material, material)
    // The system material is painted BEHIND the renderer, so the opaque pre-paint
    // colour the registry normally sets has to be dropped for it to be visible.
    assert.equal(resolved.options.backgroundColor, '#00000000', material)
  }
})

test('Windows 上 off 不产生任何选项，窗口与改动前逐字节一致', () => {
  // `off` must NOT become `backgroundMaterial: 'none'`: it is the default, so an
  // explicit value would change every existing user's window on upgrade.
  const resolved = resolveWindowMaterial('off', 'win32')
  assert.deepEqual(resolved.options, {})
  assert.equal(resolved.effective, 'off')
})

test('transparent 明确不实现：偏好保留，窗口不变', () => {
  const resolved = resolveWindowMaterial('transparent', 'win32')
  assert.deepEqual(resolved.options, {})
  assert.equal(resolved.effective, 'off')
})

test('非 Windows 平台一律不应用材质，但也不报错', () => {
  for (const platform of ['darwin', 'linux', 'freebsd'] as const) {
    for (const material of APPEARANCE_MATERIALS) {
      const resolved = resolveWindowMaterial(material, platform)
      assert.deepEqual(resolved.options, {}, `${platform}/${material}`)
      assert.equal(resolved.effective, 'off', `${platform}/${material}`)
    }
  }
})

test('effective 与 options 永远一致（页面透明的前提）', () => {
  const platforms = ['win32', 'darwin', 'linux'] as const
  for (const platform of platforms) {
    for (const material of APPEARANCE_MATERIALS) {
      const resolved = resolveWindowMaterial(material, platform)
      const painted = resolved.options.backgroundMaterial !== undefined
      assert.equal(
        painted,
        resolved.effective !== 'off',
        `${platform}/${material}: 材质是否绘制必须与 effective 一致`,
      )
    }
  }
})
