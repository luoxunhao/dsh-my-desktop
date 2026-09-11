// Reproduce the REAL desktop spawn of DSH 0.1.5-rc.1 (ipc channel, full argv,
// env) and capture why it never reaches listening. Test scaffolding.
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const project = 'E:/project/dsh/dsh-my-desktop'
const bootstrapPath = path.join(project, 'dist/src/runtime/dsh-bootstrap.mjs')
const entry = path.join(project, 'runtime-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')

const child = spawn(process.execPath, [bootstrapPath, entry, '--profile', 'web', '--port', '0', '--no-open'], {
  cwd: project,
  env: { ...process.env, DSH_DESKTOP_HOST: '1' },
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  windowsHide: true,
})

const deadline = Date.now() + 60_000
let url = null
child.stdout.on('data', d => console.log('[out]', d.toString().trim()))
child.stderr.on('data', d => console.log('[err]', d.toString().trim()))
child.on('message', m => console.log('[ipc]', JSON.stringify(m).slice(0, 120)))
child.on('exit', (code, signal) => { console.log('[exit]', code, signal); process.exit(1) })

// 0.1.5 may announce readiness over IPC instead of stdout — log everything we see.
const poll = setInterval(() => {
  if (Date.now() > deadline) { console.log('[timeout] no URL in 60s'); child.kill(); clearInterval(poll) }
}, 1000)
child.stdout.on('data', d => { const m = d.toString().match(/127\.0\.0\.1:(\d+)/); if (m) { url = m[0]; console.log('[READY]', url); clearInterval(poll); child.kill(); process.exit(0) } })
