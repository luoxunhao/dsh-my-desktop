import { pathToFileURL } from 'node:url'

const entry = process.argv[2]
if (entry === undefined) throw new Error('缺少 DSH 启动入口。')

let initialized = false
let shutdownRequested = false

function requestShutdown(): void {
  shutdownRequested = true
  if (initialized) process.emit('SIGTERM')
}

process.on('message', message => {
  if (message === 'shutdown') requestShutdown()
})
process.on('disconnect', requestShutdown)

process.argv = [process.execPath, entry, ...process.argv.slice(3)]

// DSH 0.1.5 guards its CLI with `if (import.meta.main) await runCli()`. When the
// bootstrap imports the entry as a MODULE, `import.meta.main` is false (the main
// module is this bootstrap script), so runCli never ran and the process sat alive
// but silent — the launcher saw "DSH 启动超时". The CLI exports runCli precisely
// for embedded launches like this one, so call it explicitly and keep the same
// argv contract (execPath, entry, ...dsh args).
await import(pathToFileURL(entry).href).then(async mod => {
  initialized = true
  if (typeof mod.runCli === 'function') await mod.runCli()
  // 0.1.2-era entries ran the CLI at import time (no export, no main guard); they
  // are already running by the time the import settles.
  initialized = true
})

if (shutdownRequested) process.emit('SIGTERM')
