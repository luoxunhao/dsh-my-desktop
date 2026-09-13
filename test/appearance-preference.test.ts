/**
 * The launcher's reader for the settings plugin's window-material preference.
 *
 * The reader exists to make a previously inert preference load-bearing, so every
 * test here is about the SAFE direction: when the document is absent, unreadable,
 * a version this build does not know, or carries a value it cannot use, the
 * answer must be `off` (leave the window alone) rather than a guess.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  APPEARANCE_MATERIALS,
  DEFAULT_APPEARANCE_MATERIAL,
  readAppearanceMaterial,
} from '../src/profiles/appearance-preference.js'

/** Write a state document into a fresh profile directory and return its path. */
async function profileWithState(contents: string): Promise<{ root: string, profileDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-appearance-'))
  const profileDir = join(root, 'profile')
  await mkdir(join(profileDir, '.dsh-my-settings'), { recursive: true })
  await writeFile(join(profileDir, '.dsh-my-settings', 'state.json'), contents, 'utf8')
  return { root, profileDir }
}

async function readWith(contents: string): Promise<string> {
  const { root, profileDir } = await profileWithState(contents)
  try {
    return readAppearanceMaterial(profileDir)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** A complete document, shaped exactly like the plugin's `state-store.ts` writes. */
function stateWith(material: unknown): string {
  return JSON.stringify({
    version: 1,
    market: { provider: 'disabled' },
    notifications: {
      enabled: true,
      events: { sessionEnd: true, errors: true, updates: true, progress: true },
    },
    appearance: { material, mode: 'compatibility', nativeCapable: false },
  })
}

test('没有状态文件时回退到 off（不动窗口）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-appearance-empty-'))
  try {
    const profileDir = join(root, 'profile')
    await mkdir(profileDir, { recursive: true })
    assert.equal(readAppearanceMaterial(profileDir), 'off')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('读得出插件写入的每一种材质', async () => {
  for (const material of APPEARANCE_MATERIALS) {
    assert.equal(await readWith(stateWith(material)), material, material)
  }
})

test('off 是默认值，且默认值就是「不改窗口」', () => {
  assert.equal(DEFAULT_APPEARANCE_MATERIAL, 'off')
})

test('无法识别 schema 版本时回退到 off', async () => {
  assert.equal(await readWith(JSON.stringify({ version: 2, appearance: { material: 'mica' } })), 'off')
  assert.equal(await readWith(JSON.stringify({ appearance: { material: 'mica' } })), 'off')
})

test('无法识别的材质值回退到 off，不原样透传', async () => {
  // Passing an unknown value through would reach the BrowserWindow constructor,
  // which rejects it — a corrupt file must not be able to break the launch.
  assert.equal(await readWith(stateWith('glass')), 'off')
  assert.equal(await readWith(stateWith(null)), 'off')
  assert.equal(await readWith(stateWith(7)), 'off')
})

test('损坏的 JSON 回退到 off，不抛异常', async () => {
  assert.equal(await readWith('{ not json'), 'off')
  assert.equal(await readWith('[]'), 'off')
  assert.equal(await readWith('"mica"'), 'off')
})

test('只有市场偏好的旧文档（无 appearance 字段）回退到 off', async () => {
  // The market reader accepts this shape, so the appearance reader must too —
  // otherwise every profile that only ever touched the market would fail to launch.
  assert.equal(await readWith(JSON.stringify({ version: 1, market: { provider: 'dsh-market' } })), 'off')
})

test('appearance 不是对象时回退到 off', async () => {
  assert.equal(await readWith(JSON.stringify({ version: 1, appearance: 'mica' })), 'off')
  assert.equal(await readWith(JSON.stringify({ version: 1, appearance: null })), 'off')
})
