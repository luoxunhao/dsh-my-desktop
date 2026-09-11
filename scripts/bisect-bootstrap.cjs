// Bisect: which part of dsh-bootstrap.mts breaks 0.1.5? Test scaffolding.
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const project = 'E:/project/dsh/dsh-my-desktop'
const entry = path.join(project, 'runtime-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')

// Variant 1: rewrite argv BEFORE import (as bootstrap does), WITH ipc listener
// Variant 2: rewrite argv, NO ipc listener
// Variant 3: no rewrite, no listener (control — should work like direct)
const variants = {
  v1_rewrite_ipc: `process.on('message',()=>{});process.on('disconnect',()=>{});process.argv=[process.execPath, ${JSON.stringify(entry)}, '--profile','web','--port','0','--no-open'];await import(${JSON.stringify('file:///' + entry.replace(/\\\\/g, '/'))})`,
  v2_rewrite_noipc: `process.argv=[process.execPath, ${JSON.stringify(entry)}, '--profile','web','--port','0','--no-open'];await import(${JSON.stringify('file:///' + entry.replace(/\\\\/g, '/'))})`,
  v3_plain: `process.argv=[process.execPath, ${JSON.stringify(entry)}, '--profile','web','--port','0','--no-open'];await import(${JSON.stringify('file:///' + entry.replace(/\\\\/g, '/'))})`,
}

const which = process.argv[2]
const code = variants[which]
const tmp = path.join(project, '.scratch', `bisect-${which}.mjs`)
fs.mkdirSync(path.dirname(tmp), { recursive: true })
fs.writeFileSync(tmp, code)

const child = spawn(process.execPath, [tmp], { cwd: project, stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: { ...process.env, DSH_DESKTOP_HOST: '1' } })
const timer = setTimeout(() => { console.log(`[${which}] TIMEOUT — never announced`); child.kill('SIGKILL'); process.exit(1) }, 30_000)
child.stdout.on('data', d => { const s = d.toString(); if (s.includes('127.0.0.1')) { console.log(`[${which}] READY:`, s.match(/127\.0\.0\.1:\d+/)[0]); clearTimeout(timer); child.kill(); process.exit(0) } })
child.stderr.on('data', d => console.log(`[${which}][err]`, d.toString().trim().slice(0, 150)))
child.on('exit', (code, sig) => { console.log(`[${which}] exited early:`, code, sig); clearTimeout(timer); process.exit(1) })