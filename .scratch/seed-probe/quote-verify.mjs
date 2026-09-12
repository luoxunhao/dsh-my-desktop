// Verify dsh-quote (currently built against the 0.1.2-alpha line) actually
// activates on the bundled DSH 0.1.5-rc.2 runtime, BEFORE wiring it into the
// installer. Same method used to vet dsh-codex-project.
//
// Asserts: host row applies, client bundle reaches the module graph, and the
// plugin's own host surface responds. A plugin built against an older host
// service surface can install cleanly and still fail to activate.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const project = process.cwd()
const pluginRepo = 'E:/project/dsh/dsh-quote'
const { ensureProfileScaffold } = await import(pathToFileURL(join(project, 'dist', 'src', 'profiles', 'plugin-seed.js')).href)
const { startDsh } = await import(pathToFileURL(join(project, 'dist', 'src', 'bridge', 'dsh-process.js')).href)

const root = mkdtempSync(join(tmpdir(), 'quote-verify-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'web')
mkdirSync(profile, { recursive: true })

const node = join(project, 'runtime-node', process.platform === 'win32' ? 'node.exe' : 'node')
const pnpmEntry = join(project, 'runtime-node', 'pnpm-package', 'bin', 'pnpm.cjs')

// Pack the plugin the same way we ship codex-project (prebuilt artifact).
const packDir = join(root, 'packed')
mkdirSync(packDir, { recursive: true })
const packed = await runCapture(node, [pnpmEntry, 'pack', '--pack-destination', packDir], pluginRepo)
const tarball = packed.split(/\r?\n/).map(l => l.trim()).filter(l => l.endsWith('.tgz')).pop()
console.log('1. packed:', tarball)

await ensureProfileScaffold(profile, 'web')
// Install into the profile so DSH can resolve the bundle row by package name.
await run(node, [
  pnpmEntry, 'add', `file:${tarball.replaceAll('\\', '/')}`,
  `--dir=${profile}`,
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.minimumReleaseAge=0',
], profile)
const installed = join(profile, 'node_modules', 'dsh-quote')
console.log('2. installed:', existsSync(join(installed, 'lib', 'client.js')))

// Declare it as a profile bundle so its patch layer applies.
const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
manifest.dsh = { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-quote'] } }
writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')

// Observe the loader + client graph.
const probePath = join(root, 'probe.mjs')
writeFileSync(probePath, `
import { writeFileSync } from 'node:fs'
export const name = 'quote-verify-probe'
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      const loader = ctx.get('loader')
      const modules = ctx.get('clientModules')
      const rows = []
      try { if (loader) for (const e of loader.entries()) rows.push({ id: e.options.id, name: e.options.name, state: e.fiber?.state, error: e.fiber?.error?.message }) } catch {}
      let graph = undefined
      try { graph = modules?.graph?.() } catch {}
      writeFileSync(process.env.QUOTE_PROBE, JSON.stringify({ rows, graph }), 'utf8')
    }, 100)
    return () => clearInterval(timer)
  })
}
`, 'utf8')
const probePatch = join(root, 'probe.patch.yml')
writeFileSync(probePatch, JSON.stringify([{ insert: [{ id: 'quote-verify-probe', name: pathToFileURL(probePath).href }] }]), 'utf8')

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
    DSH_TELEMETRY_DISABLED: '1', QUOTE_PROBE: resultPath,
  },
})

try {
  let probe
  for (let i = 0; i < 300; i += 1) {
    try { probe = JSON.parse(readFileSync(resultPath, 'utf8')) } catch { /* not yet */ }
    if (probe?.rows?.some(r => String(r.name).includes('quote'))) break
    await new Promise(r => setTimeout(r, 100))
  }
  const rows = (probe?.rows ?? []).filter(r => String(r.name).includes('quote') || r.id === 'quote')
  console.log('3. loader rows:')
  for (const r of rows) console.log(`   ${String(r.id).padEnd(22)} ${String(r.name).padEnd(30)} state=${r.state}${r.error ? ' ERROR=' + r.error : ''}`)
  const graph = (probe?.graph?.entries ?? []).map(e => e.id)
  const inRoster = graph.includes('dsh-quote')
  console.log('4. client roster has dsh-quote:', inRoster)

  const hostActive = rows.some(r => r.id === 'quote' && r.state === 2)
  const noError = rows.every(r => r.error === undefined)
  const ok = hostActive && inRoster && noError
  console.log(`   checks: hostActive=${hostActive} roster=${inRoster} noError=${noError}`)
  console.log(ok ? '\nPASS: dsh-quote activates on DSH 0.1.5-rc.2' : '\nFAIL: see rows above')
  if (!ok) process.exitCode = 1
} finally {
  await server.stop().catch(() => {})
  rmSync(root, { recursive: true, force: true })
}

function run(exe, args, cwd) {
  return runCapture(exe, args, cwd).then(() => undefined)
}
function runCapture(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true' } })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.once('exit', code => code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out.slice(-900)}`)))
  })
}
