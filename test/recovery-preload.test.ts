import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('恢复页 preload 仅暴露固定的恢复操作', async () => {
  const source = await readFile(new URL('../src/recovery-preload.cjs', import.meta.url), 'utf8')
  let exposed: Record<string, (...args: unknown[]) => unknown> | undefined
  const calls: Array<{ channel: string; args: unknown[] }> = []
  vm.runInNewContext(source, {
    exports: {},
    module: { exports: {} },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name: string, api: typeof exposed) => { exposed = api } },
      ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => { calls.push({ channel, args }); return Promise.resolve() } },
    }),
  })
  // The exposed surface is a FIXED list, not a generic `invoke`. That is the
  // security property: the sandboxed page can only ask for operations someone
  // deliberately published here, and can never name an arbitrary channel.
  assert.deepEqual(Object.keys(exposed ?? {}).sort(), [
    'activate',
    'dataDirectory',
    'factoryReset',
    'getStartupLog',
    'getStatus',
    'inspectCheckpoint',
    'keepIsolated',
    'listCheckpoints',
    'listProfiles',
    'openTarget',
    'restore',
    'restoreCheckpoint',
    'restoreHealthyConfig',
    'returnToWorkbench',
    'selectDataDirectory',
    'uninstall',
  ])
  await exposed?.activate()
  await exposed?.getStartupLog()
  await exposed?.restore('third-party-plugin')
  await exposed?.restoreHealthyConfig()
  await exposed?.uninstall('third-party-plugin')
  await exposed?.listCheckpoints()
  await exposed?.inspectCheckpoint('slot-2')
  await exposed?.restoreCheckpoint('slot-1')
  await exposed?.listProfiles()
  await exposed?.dataDirectory()
  await exposed?.selectDataDirectory(null)
  await exposed?.openTarget('profile-directory')
  exposed?.factoryReset?.()
  assert.deepEqual(calls, [
    { channel: 'dsh-recovery:activate', args: [] },
    { channel: 'dsh-recovery:get-startup-log', args: [] },
    { channel: 'dsh-recovery:restore', args: ['third-party-plugin'] },
    { channel: 'dsh-recovery:restore-healthy-config', args: [] },
    { channel: 'dsh-recovery:uninstall', args: ['third-party-plugin'] },
    { channel: 'dsh-recovery:list-checkpoints', args: [] },
    { channel: 'dsh-recovery:inspect-checkpoint', args: ['slot-2'] },
    { channel: 'dsh-recovery:restore-checkpoint', args: ['slot-1'] },
    { channel: 'dsh-recovery:list-profiles', args: [] },
    { channel: 'dsh-recovery:data-directory', args: [] },
    { channel: 'dsh-recovery:select-data-directory', args: [null] },
    { channel: 'dsh-recovery:open-target', args: ['profile-directory'] },
    { channel: 'dsh-recovery:factory-reset', args: [] },
  ])
})

test('preload 不提供通用的 invoke（页面无法指定任意通道）', async () => {
  const source = await readFile(new URL('../src/recovery-preload.cjs', import.meta.url), 'utf8')
  let exposed: Record<string, unknown> | undefined
  vm.runInNewContext(source, {
    exports: {},
    module: { exports: {} },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name: string, api: typeof exposed) => { exposed = api } },
      ipcRenderer: { invoke: () => Promise.resolve() },
    }),
  })
  // If a generic sender ever appeared here, a compromised page could reach every
  // handler in the main process — the allowlist would stop meaning anything.
  for (const forbidden of ['invoke', 'send', 'ipcRenderer', 'require']) {
    assert.equal(forbidden in (exposed ?? {}), false, `不应暴露通用入口：${forbidden}`)
  }
})
