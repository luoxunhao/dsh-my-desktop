// FINAL end-to-end check for 0.5.0: both vendored plugins seed offline from the
// store the INSTALLER ships, and both activate when DSH boots.
//
// Every input comes from release/win-unpacked/resources, so this exercises the
// user's real path rather than the build tree.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
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

const root = mkdtempSync(join(tmpdir(), 'final-050-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'web')
const storeDir = join(root, 'plugins', 'store')
mkdirSync(profile, { recursive: true })

extractTarGz(join(resources, 'plugins-store.tgz'), storeDir)
const node = join(project, 'runtime-node', process.platform === 'win32' ? 'node.exe' : 'node')
const pnpmEntry = join(project, 'runtime-node', 'pnpm-package', 'bin', 'pnpm.cjs')

// Seed both vendored plugins offline. They must resolve from the extracted store,
// which is where the /v11 storeDir bug used to break exactly this step.
await ensureProfileScaffold(profile, 'web')
const vendored = BUNDLED_PLUGINS.filter(p => p.vendorTarball !== undefined)
const specs = buildSeedPluginArgs(vendored, profile, { storeDir, offline: true })
console.log('seed specs:')
for (const s of specs.slice(1)) if (s.startsWith('file:')) console.log('  ', s.replace(root, '<tmp>'))
await run(node, [pnpmEntry, ...specs], profile)

for (const p of vendored) {
  const dir = join(profile, 'node_modules', ...p.packageName.split('/'))
  console.log(`${p.packageName}: installed=${existsSync(join(dir, 'lib', 'client.js'))}`)
}

// Declare them as profile bundles so both patch layers apply.
const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
manifest.dsh = { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...vendored.map(p => p.packageName)] } }
writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')

const probePath = join(root, 'probe.mjs')
writeFileSync(probePath, `
import { writeFileSync } from 'node:fs'
export const name = 'final-050-probe'
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      const loader = ctx.get('loader')
      const modules = ctx.get('clientModules')
      const rows = []
      try { if (loader) for (const e of loader.entries()) rows.push({ id: e.options.id, name: e.options.name, state: e.fiber?.state, error: e.fiber?.error?.message }) } catch {}
      let graph = undefined
      try { graph = modules?.graph?.() } catch {}
      writeFileSync(process.env.FINAL_PROBE, JSON.stringify({ rows, graph }), 'utf8')
    }, 100)
    return () => clearInterval(timer)
  })
}
`, 'utf8')
const probePatch = join(root, 'probe.patch.yml')
writeFileSync(probePatch, JSON.stringify([{ insert: [{ id: 'final-050-probe', name: pathToFileURL(probePath).href }] }]), 'utf8')

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
    DSH_TELEMETRY_DISABLED: '1', FINAL_PROBE: resultPath,
  },
})

try {
  let probe
  for (let i = 0; i < 300; i += 1) {
    try { probe = JSON.parse(readFileSync(resultPath, 'utf8')) } catch { /* not yet */ }
    const want = ['quote', 'codex-project', 'codex-project-fs']
    if (probe?.rows && want.every(id => probe.rows.some(r => r.id === id))) break
    await new Promise(r => setTimeout(r, 100))
  }
  const ids = ['quote', 'codex-project', 'codex-project-fs', 'fs-sandbox']
  console.log('\nloader rows:')
  for (const id of ids) {
    const r = (probe?.rows ?? []).find(x => x.id === id)
    console.log(`  ${id.padEnd(18)} ${r ? `state=${r.state}${r.error ? ' ERROR=' + r.error : ''}` : 'ABSENT'}`)
  }
  const graph = (probe?.graph?.entries ?? []).map(e => e.id)
  console.log('\nclient roster:')
  for (const name of ['dsh-quote', '@luoxunhao/dsh-codex-project']) {
    console.log(`  ${name.padEnd(30)} ${graph.includes(name)}`)
  }

  const quoteLive = (probe?.rows ?? []).some(r => r.id === 'quote' && r.state === 2)
  const codexLive = (probe?.rows ?? []).some(r => r.id === 'codex-project-fs' && r.state === 2)
  const fsSwapped = !(probe?.rows ?? []).some(r => r.id === 'fs-sandbox' && r.state === 2)
  const noError = (probe?.rows ?? []).every(r => r.error === undefined)
  const roster = graph.includes('dsh-quote') && graph.includes('@luoxunhao/dsh-codex-project')
  const ok = quoteLive && codexLive && fsSwapped && noError && roster
  console.log(`\nchecks: quote=${quoteLive} codex=${codexLive} fsSwapped=${fsSwapped} roster=${roster} noError=${noError}`)
  console.log(ok ? 'PASS: both vendored plugins seeded offline from the installer store and are live' : 'FAIL: see above')
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
