import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

test('桌面桥接将 Loader 的结构化启动结果经受限 IPC 交给主进程', async () => {
  // Source files live in per-layer subdirectories; preloads and main.ts stay at the root.
  const source = async (file: string): Promise<string> => {
    const root = join(process.cwd(), 'src')
    for (const candidate of [file, `app/${file}`, `bridge/${file}`, `desktop/${file}`, `infra/${file}`, `profiles/${file}`, `recovery/${file}`, `runtime/${file}`]) {
      try {
        return await readFile(join(root, candidate), 'utf8')
      } catch {
        // try the next layer
      }
    }
    throw new Error(`找不到源文件：${file}`)
  }
  const [bridge, preload, contract, policy, main, recoveryPreload, recoveryHtml] = await Promise.all([
    source('desktop-bridge-client-source.ts'),
    source('dsh-view-preload.cts'),
    source('shell-contract.ts'),
    source('shell-ipc-policy.ts'),
    source('main.ts'),
    source('recovery-preload.cts'),
    readFile(join(process.cwd(), 'assets', 'recovery.html'), 'utf8'),
  ])
  assert.match(bridge, /loader\.await\(\)/)
  assert.match(bridge, /bridge\.reportBoot\(/)
  assert.match(preload, /dshBoot: 'dsh-shell:dsh-boot'/)
  assert.match(preload, /reportBoot: \(report: unknown\)/)
  assert.match(contract, /dshBoot: 'dsh-shell:dsh-boot'/)
  assert.match(policy, /mayReportDshBoot/)
  assert.match(main, /parseRendererBootReport/)
  assert.match(main, /failStartupDiagnostic/)
  assert.match(main, /completeStartupDiagnostic/)
  assert.match(main, /captureProfileHealthCheckpoint/)
  assert.match(main, /restoreProfileHealthCheckpoint/)
  assert.match(main, /leaveRecoveryMode\(profileDir\)/)
  assert.match(main, /restartDshInRecoveryMode\(profileDir, 'workbench'\)/)
  assert.match(recoveryPreload, /restoreHealthyConfig/)
  assert.match(recoveryHtml, /恢复最近正常配置/)
})
