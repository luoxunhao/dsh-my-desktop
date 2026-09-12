// Feasibility check for shipping the PREBUILT dsh-codex-project artifact.
//
// Question: does the packed 0.12.0 tarball (built from the feat/dsh-0.1.5-support
// line) actually activate on the bundled DSH 0.1.5-rc.2 runtime?
//
// Method: install ONLY that tarball into a scratch profile, declare it as a
// profile bundle, boot DSH, and assert the three user-visible surfaces:
//   1. the plugin's host route answers,
//   2. the client roster contains it,
//   3. the core fs-sandbox row is replaced by the plugin's fs provider.
//
// Run: node .scratch/seed-probe/prebuilt-verify.mjs <path-to-tgz>
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const project = process.cwd()
const tarball = process.argv[2]
if (tarball === undefined || !existsSync(tarball)) throw new Error(`usage: node prebuilt-verify.mjs <tgz> (got ${String(tarball)})`)

const { ensureProfileScaffold } = await import(pathToFileURL(join(project, 'dist', 'src', 'profiles', 'plugin-seed.js')).href)
const { startDsh } = await import(pathToFileURL(join(project, 'dist', 'src', 'bridge', 'dsh-process.js')).href)

const root = mkdtempSync(join(tmpdir(), 'codex-prebuilt-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'web')
mkdirSync(profile, { recursive: true })

const node = join(project, 'runtime-node', process.platform === 'win32' ? 'node.exe' : 'node')
const pnpmEntry = join(project, 'runtime-node', 'pnpm-package', 'bin', 'pnpm.cjs')

// 1. Scaffold + install the tarball alone. Dependencies resolve from the SAME
// offline store the installer ships (that is the real deployment shape); a dead
// registry proves nothing leaks to the network.
await ensureProfileScaffold(profile, 'web')
const storeDir = join(root, 'plugins', 'store')
mkdirSync(join(root, 'plugins'), { recursive: true })
const { extractTarGz } = await import(pathToFileURL(join(project, 'dist', 'src', 'infra', 'runtime-archive.js')).href)
const shippedStore = join(project, 'release', 'win-unpacked', 'resources', 'plugins-store.tgz')
if (!existsSync(shippedStore)) throw new Error('run `pwsh -File scripts/build.ps1 -Target pack-local` first (need the packaged store)')
extractTarGz(shippedStore, storeDir)
console.log('0. shipped store extracted:', existsSync(storeDir))

await run(node, [
  pnpmEntry, 'add', `file:${tarball.replaceAll('\\', '/')}`,
  `--dir=${profile}`,
  `--store-dir=${storeDir}`,
  `--cache-dir=${join(storeDir, 'cache')}`,
  '--offline',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.minimumReleaseAge=0',
  // Same registry the store's offline metadata cache is keyed to. `--offline`
  // makes any real network access fail, so this still proves nothing is fetched.
  '--registry=https://registry.npmjs.org/',
], profile)
const installedDir = join(profile, 'node_modules', '@luoxunhao', 'dsh-codex-project')
console.log('1. installed:', existsSync(join(installedDir, 'lib', 'client.js')))
for (const f of ['lib/index.js', 'lib/client.js', 'lib/runner.js', 'lib/fs.js', 'cordis.patch.yml']) {
  console.log(`   ${f}: ${existsSync(join(installedDir, f))}`)
}
console.log('   koffi native:', existsSync(join(profile, 'node_modules', '@koromix', 'koffi-win32-x64', 'win32_x64', 'koffi.node')))

// 2. Declare as a profile bundle so its patch layer (incl. the fs swap) applies.
const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
manifest.dsh = { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@luoxunhao/dsh-codex-project'] } }
writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')

// 3. Boot and observe the loader + client roster.
const probePath = join(root, 'probe.mjs')
writeFileSync(probePath, `
import { writeFileSync } from 'node:fs'
export const name = 'codex-prebuilt-probe'
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
writeFileSync(probePatch, JSON.stringify([{ insert: [{ id: 'codex-prebuilt-probe', name: pathToFileURL(probePath).href }] }]), 'utf8')

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
  console.log('3. client roster has plugin:', inRoster)
  const ping = await routeStatus(server.url, '/codex-project/api/ping')
  console.log('4. host route:', ping)

  const fsDisabled = rows.some(r => r.id === 'fs-sandbox' && r.state === undefined)
  const fsSwapLive = rows.some(r => r.id === 'codex-project-fs' && r.state === 2)
  const hostLive = ping.startsWith('200')
  console.log(`   checks: roster=${inRoster} host=${hostLive} fsDisabled=${fsDisabled} fsSwap=${fsSwapLive}`)
  const ok = inRoster && hostLive && fsDisabled && fsSwapLive
  console.log(ok ? '\nPASS: prebuilt artifact activates on DSH 0.1.5-rc.2' : '\nFAIL: see above')
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
    child.once('exit', code => code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out.slice(-800)}`)))
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
