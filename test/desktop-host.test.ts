import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { OFFICIAL_DSH_VERSION } from '../src/runtime/bundled-plugins.js'
import { createDesktopHostServices, DESKTOP_BRIDGE_FILES, prepareDesktopBridge, officialPluginUpdateVersion, runBundledPnpm } from '../src/bridge/desktop-host.js'
import { removeDesktopBridgePatch } from '../src/bridge/desktop-bridge-migration.js'
import { pathToFileURL } from 'node:url'

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
}

/**
 * THE BEHAVIOUR THESE CASES PIN: a successful plugin command must NOT ask the
 * launcher to reload DSH.
 *
 * The bridge used to send an update-applied notification after every successful
 * add/remove/update, and the launcher reloaded the whole workbench on receipt —
 * so installing a plugin from the market restarted the desktop under the user.
 * Reloading is now reachable only from an explicit user action (title-bar
 * reload, Cmd/Ctrl+R, the tray item), so `sent` must stay empty here.
 */

test('插件安装成功后不得自动重载 DSH', async () => {
  const sent: unknown[] = []
  const host = createDesktopHostServices({
    profileName: 'web',
    profileDir: 'D:\\profile\\web',
    send: (message) => { sent.push(message) },
    runner: () => {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      stdout.end()
      stderr.end()
      return {
        stdout,
        stderr,
        done: Promise.resolve({ exitCode: 0, signal: null }),
        cancel: () => undefined,
      }
    },
  })
  assert.equal(host.desktopProfiles.current.name, 'web')
  assert.equal(host.desktopProfiles.connected, true)
  assert.equal(host.desktopPnpm.connected, true)
  assert.equal(typeof host.desktopPnpm.run, 'function')
  await host.desktopPnpm.runPlugin(['add', 'demo@1.0.0'], 'D:\\profile\\web').done
  // Give the old delayed notification every chance to appear before asserting.
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(sent, [])
})

test('插件版本未变化时不通知重载', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-stale-update-'))
  try {
    await mkdir(join(root, 'node_modules', 'dsh-better-sidebar'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-better-sidebar': '^0.14.0' },
      dsh: { profile: { bundles: ['dsh-better-sidebar'] } },
    }), 'utf8')
    await writeFile(join(root, 'node_modules', 'dsh-better-sidebar', 'package.json'), JSON.stringify({
      name: 'dsh-better-sidebar',
      version: '0.14.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }), 'utf8')
    await writeFile(join(root, 'node_modules', 'dsh-better-sidebar', 'cordis.patch.yml'), '[]\n', 'utf8')
    const sent: unknown[] = []
    const host = createDesktopHostServices({
      profileName: 'web',
      profileDir: root,
      send: (message) => { sent.push(message) },
      runner: () => {
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        stdout.end()
        stderr.end()
        return {
          stdout,
          stderr,
          done: Promise.resolve({ exitCode: 0, signal: null }),
          cancel: () => undefined,
        }
      },
    })

    await host.desktopPnpm.runPlugin(['add', 'dsh-better-sidebar'], root).done
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.deepEqual(sent, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('插件版本真的变化了也不通知重载（重载交给用户）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-version-update-'))
  try {
    await mkdir(join(root, 'node_modules', 'dsh-better-sidebar'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-better-sidebar': '^0.14.0' },
      dsh: { profile: { bundles: ['dsh-better-sidebar'] } },
    }), 'utf8')
    const packagePath = join(root, 'node_modules', 'dsh-better-sidebar', 'package.json')
    await writeFile(packagePath, JSON.stringify({ name: 'dsh-better-sidebar', version: '0.14.0' }), 'utf8')
    const sent: unknown[] = []
    const host = createDesktopHostServices({
      profileName: 'web',
      profileDir: root,
      send: (message) => { sent.push(message) },
      runner: () => {
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        stdout.end()
        stderr.end()
        return {
          stdout,
          stderr,
          done: writeFile(packagePath, JSON.stringify({ name: 'dsh-better-sidebar', version: '0.14.1' }), 'utf8')
            .then(() => ({ exitCode: 0, signal: null })),
          cancel: () => undefined,
        }
      },
    })

    await host.desktopPnpm.runPlugin(['add', 'dsh-better-sidebar'], root).done
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.deepEqual(sent, [], '版本变化后仍不得自动重载，重载只能由用户触发')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('桌面插件命令必须在 profile 根目录执行', async () => {
  const profileDir = 'D:\\profile\\web'
  let workingDirectory = ''
  const host = createDesktopHostServices({
    profileName: 'web',
    profileDir,
    runner: (_args, cwd) => {
      workingDirectory = cwd
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      stdout.end()
      stderr.end()
      return {
        stdout,
        stderr,
        done: Promise.resolve({ exitCode: 0, signal: null }),
        cancel: () => undefined,
      }
    },
  })
  await host.desktopPnpm.runPlugin(['add', '-w', 'dshmarket@latest'], 'D:\\runtime').done
  assert.equal(workingDirectory, profileDir)
})

test('安装失败时不得把残留包写进运行清单或重启', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-failed-install-'))
  try {
    await mkdir(join(root, 'node_modules', 'dsh-file-upload'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'dsh-file-upload', 'package.json'), JSON.stringify({
      name: 'dsh-file-upload',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }), 'utf8')
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-file-upload': '^0.4.3' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }), 'utf8')
    const sent: unknown[] = []
    const host = createDesktopHostServices({
      profileName: 'web',
      profileDir: root,
      send: (message) => { sent.push(message) },
      runner: () => {
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        stdout.end()
        stderr.end()
        return {
          stdout,
          stderr,
          done: Promise.resolve({ exitCode: 1, signal: null }),
          cancel: () => undefined,
        }
      },
    })
    await host.desktopPnpm.runPlugin(['add', 'dsh-file-upload@0.4.3'], root).done
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    assert.equal(manifest.dsh?.profile?.bundles?.includes('dsh-file-upload'), false)
    assert.deepEqual(sent, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('可忽略的依赖脚本提示不影响安装成功的收尾', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ignored-scripts-'))
  try {
    await mkdir(join(root, 'node_modules', 'dsh-file-upload'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'dsh-file-upload', 'package.json'), JSON.stringify({
      name: 'dsh-file-upload',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }), 'utf8')
    await writeFile(join(root, 'node_modules', 'dsh-file-upload', 'cordis.patch.yml'), '[]\n', 'utf8')
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-file-upload': '^0.4.3' },
      dsh: { profile: { bundles: [] } },
    }), 'utf8')
    const sent: unknown[] = []
    const host = createDesktopHostServices({
      profileName: 'web',
      profileDir: root,
      send: (message) => { sent.push(message) },
      runner: () => {
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        queueMicrotask(() => {
          stdout.end('Ignored build scripts: sharp, tesseract.js')
          stderr.end()
        })
        return {
          stdout,
          stderr,
          done: Promise.resolve({ exitCode: 0, signal: null }),
          cancel: () => undefined,
        }
      },
    })
    await host.desktopPnpm.runPlugin(['add', 'dsh-file-upload@0.4.3'], root).done
    await waitFor(async () => {
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
      return manifest.dsh?.profile?.bundles?.includes('dsh-file-upload') === true
    })
    // The manifest is reconciled so the plugin is active next start…
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    assert.equal(manifest.dsh?.profile?.bundles?.includes('dsh-file-upload'), true)
    // …but nothing asks the launcher to reload now.
    assert.deepEqual(sent, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('带注释的空 patch 不会再拼出非法 YAML', () => {
  assert.equal(removeDesktopBridgePatch('# keep\n[]\n'), '# keep\n[]\n')
})

test('已损坏的 bridge+空数组 patch 会被修回合法 YAML', () => {
  const broken = '- id: dsh-desktop-bridge\n  name: dsh-desktop-bridge\n# note\n[]\n'
  const next = removeDesktopBridgePatch(broken)
  assert.match(next, /# note/)
  assert.doesNotMatch(next, /dsh-desktop-bridge/)
  assert.match(next, /\[\]/)
})

test('官方包更新会锁成同一个版本号', () => {
  assert.equal(officialPluginUpdateVersion(['add', '@deepseek-ai/dsh@0.1.0-rc.9']), '0.1.0-rc.9')
  assert.equal(officialPluginUpdateVersion(['update', '@deepseek-ai/dsh-attachment-local']), OFFICIAL_DSH_VERSION)
  assert.equal(officialPluginUpdateVersion(['add', '@sample/plugin-a@0.2.61']), undefined)
})

test('官方运行时卸载会返回明确失败而不是伪成功', async () => {
  const host = createDesktopHostServices({
    profileName: 'web',
    profileDir: 'D:\\profile\\web',
    desktopRuntimeDir: 'D:\\runtime',
  })
  const handle = host.desktopPnpm.runPlugin(['remove', '@deepseek-ai/dsh'], 'D:\\profile\\web')
  let stderr = ''
  handle.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
  assert.deepEqual(await handle.done, { exitCode: 1, signal: null })
  assert.match(stderr, /不能从插件市场卸载/)
})

test('官方 peer 不会被单独安装进 Web profile', async () => {
  const host = createDesktopHostServices({
    profileName: 'web',
    profileDir: 'D:\\profile\\web',
    desktopRuntimeDir: 'D:\\runtime',
    runner: () => { throw new Error('不应调用 profile pnpm') },
  })
  const handle = host.desktopPnpm.runPlugin(['add', '@deepseek-ai/cordis-plugin-group@1.0.2'], 'D:\\profile\\web')
  let stderr = ''
  handle.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
  assert.deepEqual(await handle.done, { exitCode: 1, signal: null })
  assert.match(stderr, /不能单独安装到 Web profile/)
})

test('同一命令混装官方包和社区包时明确拒绝，不静默漏装社区包', async () => {
  const host = createDesktopHostServices({
    profileName: 'web',
    profileDir: 'D:\\profile\\web',
    desktopRuntimeDir: 'D:\\runtime',
    runner: () => { throw new Error('混合命令不应执行') },
  })
  const handle = host.desktopPnpm.runPlugin(['add', '@deepseek-ai/dsh@0.1.0-rc.8', 'community-plugin@1.0.0'], 'D:\\profile\\web')
  let stderr = ''
  handle.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
  assert.deepEqual(await handle.done, { exitCode: 1, signal: null })
  assert.match(stderr, /不能在同一条命令中混合/)
})

test('安装桌面桥接时缺少任一依赖都会立即失败', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bridge-files-'))
  const source = join(root, 'source')
  const profile = join(root, 'profile')
  try {
    await mkdir(source, { recursive: true })
    await writeFile(join(source, DESKTOP_BRIDGE_FILES[0]), '', 'utf8')
    assert.throws(() => prepareDesktopBridge(profile, source), /桌面桥接文件缺失/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('查询 pnpm 版本不会触发 profile 清理或重载', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pnpm-query-'))
  const manifest = '{"dsh":{"profile":{"bundles":["user-plugin"]}}}'
  try {
    await writeFile(join(root, 'package.json'), manifest, 'utf8')
    const host = createDesktopHostServices({ profileDir: root, profileName: 'web', runner: successfulHandle, send: () => assert.fail('查询不能重载') })
    await host.desktopPnpm.run(['--version']).done
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), manifest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('桌面桥接清单同时声明 host 与 client 入口', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bridge-client-'))
  const source = join(root, 'source')
  const profile = join(root, 'Desktop 私有目录')
  try {
    await mkdir(source, { recursive: true })
    for (const file of DESKTOP_BRIDGE_FILES) await writeFile(join(source, file), '', 'utf8')
    const patch = prepareDesktopBridge(profile, source)
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
      exports?: Record<string, string>
      dsh?: { bundle?: { patch?: string }; client?: { inject?: string[]; platform?: string } }
    }
    assert.equal(manifest.exports?.['./client'], './desktop-bridge-client.js')
    assert.equal(manifest.exports?.['./package.json'], './package.json')
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.equal(manifest.dsh?.client?.platform, 'web')
    assert.equal(manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-locale'), true)
    assert.match(await readFile(join(profile, 'desktop-bridge-client.js'), 'utf8'), /window\.__ModuleLoader__\.load/)
    assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), '[]\n')
    const profileManifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    assert.equal(profileManifest.dsh?.profile, undefined)
    const expected = [{ insert: [{ id: 'dsh-desktop-bridge', name: pathToFileURL(join(profile, 'desktop-bridge.mjs')).href }] }]
    assert.deepEqual(JSON.parse(await readFile(patch, 'utf8')), expected)
    assert.equal(prepareDesktopBridge(profile, source), patch)
    assert.deepEqual(JSON.parse(await readFile(patch, 'utf8')), expected)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('后续成功安装不会激活上次失败留下的无关依赖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-stale-install-'))
  try {
    for (const packageName of ['stale-plugin', 'good-plugin']) {
      await mkdir(join(root, 'node_modules', packageName), { recursive: true })
      await writeFile(join(root, 'node_modules', packageName, 'package.json'), JSON.stringify({
        name: packageName,
        dsh: { bundle: { patch: 'cordis.patch.yml' } },
      }), 'utf8')
      await writeFile(join(root, 'node_modules', packageName, 'cordis.patch.yml'), '[]\n', 'utf8')
    }
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { 'stale-plugin': '1.0.0', 'good-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }), 'utf8')
    const host = createDesktopHostServices({
      profileName: 'web',
      profileDir: root,
      runner: () => successfulHandle(),
    })
    await host.desktopPnpm.runPlugin(['add', 'good-plugin@1.0.0'], root).done
    await waitFor(async () => {
      const current = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
      return current.dsh?.profile?.bundles?.includes('good-plugin') === true
    })
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    assert.equal(manifest.dsh?.profile?.bundles?.includes('good-plugin'), true)
    assert.equal(manifest.dsh?.profile?.bundles?.includes('stale-plugin'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('市场 pnpm 超时后会结束子进程并返回超时退出码', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-timeout-'))
  const previous = process.env.DSH_PNPM_ENTRY
  try {
    const pnpmEntry = join(root, 'hanging-pnpm.cjs')
    await writeFile(pnpmEntry, 'setInterval(() => undefined, 1000)\n', 'utf8')
    process.env.DSH_PNPM_ENTRY = pnpmEntry
    const handle = runBundledPnpm([], root, undefined, 30)
    let stderr = ''
    handle.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
    assert.deepEqual(await handle.done, { exitCode: 124, signal: null })
    assert.match(stderr, /pnpm 操作超时/)
  } finally {
    if (previous === undefined) delete process.env.DSH_PNPM_ENTRY
    else process.env.DSH_PNPM_ENTRY = previous
    await rm(root, { recursive: true, force: true })
  }
})

function successfulHandle() {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdout.end()
  stderr.end()
  return {
    stdout,
    stderr,
    done: Promise.resolve({ exitCode: 0, signal: null }),
    cancel: () => undefined,
  }
}
