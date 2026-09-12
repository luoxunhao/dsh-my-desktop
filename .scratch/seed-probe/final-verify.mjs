// FINAL end-to-end check for the VENDORED-ARTIFACT approach.
//
//   packaged installer store → offline seed → boot DSH → assert it works
//
// Mirrors what a user gets: every input comes from release/win-unpacked/resources.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const project = process.cwd()
const resources = join(project, 'release', 'win-unpacked', 'resources')
const { extractTarGz } = await import(pathToFileURL(join(project, 'dist', 'src', 'infra', 'runtime-archive.js')).href)
const { buildSeedPluginArgs, ensureProfileScaffold } = await import(pathToFileURL(join(project, 'dist', 'src', 'profiles', 'plugin-seed.js')).href)
const { BUNDLED_PLUGINS } = await import(pathToFileURL(join(project, 'dist', 'src', 'runtime', 'bundled-plugins.js')).href)
const { startDsh } = await import(pathToFileURL(join(project, 'dist', 'src', 'bridge', 'dsh-process.js')).href)

const root = mkdtempSync(join(tmpdir(), 'codex-final-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'web')
const storeDir = join(root, 'plugins', 'store')
mkdirSync(profile, { recursive: true })

// 1. Store exactly as the installer ships it.
extractTarGz(join(resources, 'plugins-store.tgz'), storeDir)

// 2. Offline seed of ONLY the vendored plugin (registry plugins legitimately need
//    their own metadata; this isolates the artifact path under test).
await ensureProfileScaffold(profile, 'web')
const codex = BUNDLED_PLUGINS.find(p => p.vendorTarball !== undefined)
const pnpmEntry = join(project, 'runtime-node', 'pnpm-package', 'bin', 'pnpm.cjs')
const node = join(project, 'runtime-node', process.platform === 'win32' ? 'node.exe' : 'node')
const args = buildSeedPluginArgs([codex], profile, { storeDir, offline: true })
await run(node, [pnpmEntry, ...args], profile)
const base = join(profile, 'node_modules', '@luoxunhao', 'dsh-codex-project')
console.log('1. offline seed from shipped store:', existsSync(join(base, 'lib', 'client.js')))
console.log('   seed spec used:', args[1])
console.log('   koffi native:', existsSync(join(profile, 'node_modules', '@koromix', 'koffi-win32-x64', 'win32_x64', 'koffi.node')))

// 3. Declare as a profile bundle so its patch layer (incl. the fs swap) applies.
const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
manifest.dsh = { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@luoxunhao/dsh-codex-project'] } }
writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')

// 4. Boot and observe.
const probePath = join(root, 'probe.mjs')
writeFileSync(probePath, `
import { writeFileSync } from 'node:fs'
export const name = 'codex-final-probe'
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      const loader = ctx.get('loader')
      const modules = ctx.get('clientModules')
      const rows = []
      try { if (loader) for (const e of loader.entries()) rows.push({ id: e.options.id, name: e.options.name, state: e.fiber?.state }) } catch {}
      let graph = undefined
      try { graph = modules?.graph?.() } catch {}
      writeFileSync(process.env.CODEX_PROBE, JSON.stringify({ rows, graph }), 'utf8')
    }, 100)
    return () => clearInterval(timer)
  })
}
`, 'utf8')
const probePatch = join(root, 'probe.patch.yml')
writeFileSync(probePatch, JSON.stringify([{ insert: [{ id: 'codex-final-probe', name: pathToFileURL(probePath).href }] }]), 'utf8')

const resultPath = join(root, 'probe.json')
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
    DSH_TELEMETRY_DISABLED: '1', CODEX_PROBE: resultPath,
  },
})

try {
  let probe
  for (let i = 0; i < 300; i += 1) {
    try { probe = JSON.parse(readFileSync(resultPath, 'utf8')) } catch { /* not yet */ }
    if (probe?.rows?.some(r => String(r.name).includes('codex'))) break
    await new Promise(r => setTimeout(r, 100))
  }
  const rows = (probe?.rows ?? []).filter(r => String(r.name).includes('codex') || r.id === 'fs-sandbox')
  console.log('2. loader rows:')
  for (const r of rows) console.log(`   ${String(r.id).padEnd(20)} ${String(r.name).padEnd(45)} state=${r.state}`)
  const graph = (probe?.graph?.entries ?? []).map(e => e.id)
  const inRoster = graph.includes('@luoxunhao/dsh-codex-project')
  const ping = await routeStatus(server.url, '/codex-project/api/ping')
  console.log('3. client roster:', inRoster, '| 4. host route:', ping)

  const fsDisabled = rows.some(r => r.id === 'fs-sandbox' && r.state === undefined)
  const fsSwap = rows.some(r => r.id === 'codex-project-fs' && r.state === 2)
  const ok = inRoster && ping.startsWith('200') && fsDisabled && fsSwap
  console.log(ok ? '\nPASS: preinstalled from vendored artifact, fully offline' : '\nFAIL: see above')
  if (!ok) process.exitCode = 1
} finally {
  await server.stop().catch(() => {})
  rmSync(root, { recursive: true, force: true })
}

function run(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true' } })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.once('exit', code => code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out.slice(-900)}`)))
  })
}

async function routeStatus(base, path) {
  for (let i = 0; i < 150; i += 1) {
    try {
      const boot = await fetch(base, { redirect: 'manual' })
      const cookie = boot.headers.getSetCookie?.().map(v => v.split(';')[0]).join('; ') ?? ''
      await boot.body?.cancel()
      const res = await fetch(new URL(path, base), { headers: { cookie, accept: 'application/json' }, redirect: 'manual' })
      const text = await res.text().catch(() => '')
      if (res.status !== 404) return `${res.status} ${text.slice(0, 100)}`
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 200))
  }
  return 'no response'
}
