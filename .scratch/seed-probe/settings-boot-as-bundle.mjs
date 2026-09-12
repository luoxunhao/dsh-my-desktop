// Follow-up: the settings plugin SURVIVES the bundle lifecycle (previous probe).
// So the remaining question is whether it actually BOOTS as a profile bundle —
// the 0.4.0 comment's premise turned out to be stale, so the only honest way to
// answer "why not install it the same way?" is to try it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const project = process.cwd()
const PKG = 'dsh-my-desktop-setting'
const { ensureProfileScaffold } = await import(pathToFileURL(join(project, 'dist', 'src', 'profiles', 'plugin-seed.js')).href)
const { startDsh } = await import(pathToFileURL(join(project, 'dist', 'src', 'bridge', 'dsh-process.js')).href)

const root = mkdtempSync(join(tmpdir(), 'settings-boot-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'web')
mkdirSync(profile, { recursive: true })
await ensureProfileScaffold(profile, 'web')

// Install it into the profile like any vendored plugin.
const installed = join(profile, 'node_modules', PKG)
mkdirSync(join(installed, 'lib'), { recursive: true })
const src = join(project, 'plugins', 'dsh-my-desktop-settings')
cpSync(join(src, 'lib', 'index.js'), join(installed, 'lib', 'index.js'))
cpSync(join(src, 'lib', 'client.js'), join(installed, 'lib', 'client.js'))
cpSync(join(src, 'cordis.patch.yml'), join(installed, 'cordis.patch.yml'))
writeFileSync(join(installed, 'package.json'), readFileSync(join(src, 'package.json')), 'utf8')

const m = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
m.dependencies = { [PKG]: 'file:...' }
m.dsh = { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PKG] } }
writeFileSync(join(profile, 'package.json'), JSON.stringify(m, undefined, 2) + '\n', 'utf8')

const probePath = join(root, 'probe.mjs')
writeFileSync(probePath, `
import { writeFileSync } from 'node:fs'
export const name = 'settings-boot-probe'
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      const loader = ctx.get('loader')
      const modules = ctx.get('clientModules')
      const rows = []
      try { if (loader) for (const e of loader.entries()) rows.push({ id: e.options.id, name: e.options.name, state: e.fiber?.state, error: e.fiber?.error?.message }) } catch {}
      let graph = undefined
      try { graph = modules?.graph?.() } catch {}
      writeFileSync(process.env.SB_PROBE, JSON.stringify({ rows, graph }), 'utf8')
    }, 100)
    return () => clearInterval(timer)
  })
}
`, 'utf8')
const probePatch = join(root, 'probe.patch.yml')
writeFileSync(probePatch, JSON.stringify([{ insert: [{ id: 'settings-boot-probe', name: pathToFileURL(probePath).href }] }]), 'utf8')

const resultPath = join(root, 'probe.json')
const node = join(project, 'runtime-node', process.platform === 'win32' ? 'node.exe' : 'node')
const server = await startDsh({
  bootstrapPath: join(project, 'dist', 'src', 'runtime', 'dsh-bootstrap.mjs'),
  patches: [probePatch],
  profileName: 'web',
  runtime: { root: join(project, 'runtime-dsh'), entry: join(project, 'runtime-dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js') },
  nodeExecutable: node,
  workingDirectory: root,
  environment: {
    DSH_HOME: home, DSH_PROFILE_DIR: profile, DSH_PROFILE_NAME: 'web',
    USERPROFILE: home, HOME: home, APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, '.config'),
    DSH_TELEMETRY_DISABLED: '1', SB_PROBE: resultPath,
  },
})

try {
  let probe
  for (let i = 0; i < 300; i += 1) {
    try { probe = JSON.parse(readFileSync(resultPath, 'utf8')) } catch { /* not yet */ }
    if (probe?.rows?.some(r => String(r.id).includes('desktop-settings'))) break
    await new Promise(r => setTimeout(r, 100))
  }
  const rows = (probe?.rows ?? []).filter(r => String(r.id).includes('desktop-settings') || String(r.name).includes('my-desktop-setting'))
  console.log('loader rows:')
  for (const r of rows) console.log(`  id=${r.id} name=${r.name} state=${r.state}${r.error ? ' ERROR=' + r.error : ''}`)
  const graph = (probe?.graph?.entries ?? []).map(e => e.id)
  console.log('client roster has it:', graph.includes(PKG))
  // Its host half registers /api/dsh-my-settings
  const status = await routeStatus(server.url, '/api/dsh-my-settings/state')
  console.log('host route /api/dsh-my-settings/state ->', status)
  const ok = rows.some(r => r.state === 2 && !r.error) && graph.includes(PKG)
  console.log(ok ? '\nRESULT: it DOES boot as a profile bundle' : '\nRESULT: it does NOT boot as a profile bundle')
} finally {
  await server.stop().catch(() => {})
  rmSync(root, { recursive: true, force: true })
}

async function routeStatus(base, path) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const boot = await fetch(base, { redirect: 'manual' })
      const cookie = boot.headers.getSetCookie?.().map(v => v.split(';')[0]).join('; ') ?? ''
      await boot.body?.cancel()
      const res = await fetch(new URL(path, base), { headers: { cookie, accept: 'application/json' }, redirect: 'manual' })
      await res.body?.cancel()
      if (res.status !== 404) return String(res.status)
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 200))
  }
  return 'no response'
}
