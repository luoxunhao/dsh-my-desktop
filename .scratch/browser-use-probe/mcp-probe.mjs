// 一次性探针：不经过 DSH，直接按 provider 的参数拼法拉起 @playwright/mcp，
// 跑 initialize → tools/list → 一次真实 navigate + screenshot，验证
// `--executable-path` 指向系统 Chrome/Edge 时整条链路是否可用。
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const PROFILE = process.env.HOME + '/.dsh/profiles/dsh-my-desktop'
const candidates = [
  ['缓存 chromium（不给 executable-path，让 playwright 自己找）', undefined],
  ['系统 Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  ['系统 Edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
]

function resolveCli() {
  return [PROFILE + '/node_modules/@playwright/mcp/cli.js', 'D:\\Program Files\\DSH My Desktop\\dsh-runtime\\node_modules\\@playwright\\mcp\\cli.js']
    .find((p) => existsSync(p))
}

async function run(label, execPath) {
  const cli = resolveCli()
  if (cli === undefined) return console.log('找不到 @playwright/mcp/cli.js（profile 里的包可能已被启动对账摘掉）')
  const args = [cli, '--browser', 'chromium', '--isolated', '--headless']
  if (execPath !== undefined) args.push('--executable-path', execPath)
  const child = spawn(process.execPath, args, {
    // provider 实测会把子进程 env 清成只有 PLAYWRIGHT_MCP_*（且置空），这里照抄以复现真实条件。
    env: Object.fromEntries(Object.keys(process.env).filter((k) => k.toUpperCase().startsWith('PLAYWRIGHT_MCP_')).map((k) => [k, ''])),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const rl = createInterface({ input: child.stdout })
  const pending = new Map()
  let seq = 0
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  rl.on('line', (line) => {
    let msg
    try { msg = JSON.parse(line) } catch { return }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error === undefined ? resolve(msg.result) : reject(new Error(JSON.stringify(msg.error)))
    }
  })
  const stderr = []
  child.stderr.on('data', (d) => stderr.push(d.toString()))
  const timer = setTimeout(() => { child.kill(); finish(new Error('超时 90s')) }, 90000)
  const finish = (error) => {
    clearTimeout(timer)
    child.kill()
    if (error !== undefined) {
      console.log(`✗ ${label}: ${error.message}`)
      if (stderr.length > 0) console.log('   stderr: ' + stderr.join('').slice(0, 400))
    }
  }
  try {
    await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    const tools = await send('tools/list', {})
    const names = tools.tools.map((t) => t.name)
    console.log(`✓ ${label}: ${names.length} 个工具`)
    console.log('   ' + names.slice(0, 12).join(', '))
    await send('tools/call', { name: 'browser_navigate', arguments: { url: 'data:text/html,<h1>dsh browser-use probe</h1>' } })
    const shot = await send('tools/call', { name: 'browser_take_screenshot', arguments: { type: 'png', filename: 'probe-shot.png' } })
    const images = (shot.content ?? []).filter((c) => c.type === 'image')
    console.log(`   navigate + screenshot OK，图片 ${images.length} 段、共 ${images.reduce((n, i) => n + (i.data?.length ?? 0), 0)} 字符 base64`)
    finish()
  } catch (error) {
    finish(error)
  }
}

const which = process.argv[2]
const picked = which === undefined ? candidates : candidates.filter(([, p]) => (p ?? 'cache') === which)
for (const [label, p] of picked) {
  console.log(`\n=== ${label}${p === undefined ? '' : '  ' + p}`)
  await run(label, p)
}
void writeFileSync
