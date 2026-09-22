import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { MARKET_PROVIDER_DISABLED, MARKET_PROVIDER_DSH, applyMarketPreference, readMarketProvider } from '../src/profiles/market-preference.js'

const CATALOG = [{ packageName: 'dshmarket', version: '1.45.1' }, { packageName: 'dsh-quote', version: '0.1.0' }]

async function freshProfile(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-market-pref-'))
}

test('没有状态文件的新 profile 默认开市场，dshmarket 进补种清单', async () => {
  const root = await freshProfile()
  try {
    assert.equal(readMarketProvider(root), MARKET_PROVIDER_DSH)
    assert.deepEqual(applyMarketPreference(CATALOG, root).map(plugin => plugin.packageName), ['dshmarket', 'dsh-quote'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('显式 disabled 仍然把市场挡在补种之外', async () => {
  const root = await freshProfile()
  try {
    await mkdir(join(root, '.dsh-my-settings'), { recursive: true })
    await writeFile(join(root, '.dsh-my-settings', 'state.json'), JSON.stringify({ version: 1, market: { provider: 'disabled' } }), 'utf8')
    assert.equal(readMarketProvider(root), MARKET_PROVIDER_DISABLED)
    assert.deepEqual(applyMarketPreference(CATALOG, root).map(plugin => plugin.packageName), ['dsh-quote'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('状态文件读不动时不用产品默认值替它说话', async () => {
  const root = await freshProfile()
  try {
    await mkdir(join(root, '.dsh-my-settings'), { recursive: true })
    await writeFile(join(root, '.dsh-my-settings', 'state.json'), '{ 这不是 JSON', 'utf8')
    assert.equal(readMarketProvider(root), MARKET_PROVIDER_DISABLED)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
