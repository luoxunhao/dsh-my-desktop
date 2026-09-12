// End-to-end: install a NEWER settings plugin into the version store, boot DSH,
// and prove the launcher actually runs the new copy (not the shipped baseline).
//
// This is the whole point of "independently upgradeable": a settings change lands
// without rebuilding the 300 MB installer.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const project = process.cwd()
const { prepareDesktopSettings } = await import(pathToFileURL(join(project, 'dist', 'src', 'bridge', 'desktop-settings-plugin.js')).href)
const { startDsh } = await import(pathToFileURL(join(project, 'dist', 'src', 'bridge', 'dsh-process.js')).href)
const { ensureProfileScaffold } = await import(pathToFileURL(join(project, 'dist', 'src', 'profiles', 'plugin-seed.js')).href)

const root = mkdtempSync(join(tmpdir(), 'settings-e2e-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'web')
mkdirSync(profile, { recursive: true })
await ensureProfileScaffold(profile, 'web')

// The app's shipped source (baseline 0.5.0 per its own manifest).
const source = join(project, 'plugins', 'dsh-my-desktop-settings')
const baseline = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version
console.log('shipped baseline version:', baseline)

// The version store, as the launcher owns it under userData.
const store = join(root, 'desktop-settings-plugin')

// Install it through the SAME helper the install script uses, so the manifest
// carries the full DSH bundle/client contract (a hand-written package.json
// without `dsh.client` would make DSH treat it as host-only).
const newer = '9.9.9'
const { installSettingsVersion } = await import(pathToFileURL(join(project, 'dist', 'src', 'bridge', 'desktop-settings-store.js')).href)
// Seed the baseline first (as the launcher does), then install the newer copy.
installSettingsVersion(store, source, baseline)
installSettingsVersion(store, source, newer)
// Tag the NEWER client bundle so we can tell which copy the browser loaded.
const newerClient = join(store, newer, 'lib', 'client.js')
writeFileSync(newerClient, `// UPGRADED-TO-${newer}\n${readFileSync(newerClient, 'utf8')}`, 'utf8')

const patch = prepareDesktopSettings(store, source, '0.0.0')
console.log('overlay row name:', JSON.parse(readFileSync(patch, 'utf8'))[0].insert[0].name)
const name = JSON.parse(readFileSync(patch, 'utf8'))[0].insert[0].name
console.log('overlay points at upgraded copy:', name.includes(newer))

// Boot and confirm the UPGRADED client bundle is what gets served.
const probePath = join(root, 'probe.mjs')
writeFileSync(probePath, `
import { writeFileSync } from 'node:fs'
export const name = 'settings-e2e-probe'
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      const modules = ctx.get('clientModules')
      let graph = undefined
      try { graph = modules?.graph?.() } catch {}
      writeFileSync(process.env.SE_PROBE, JSON.stringify({ graph }), 'utf8')
    }, 100)
    return () => clearInterval(timer)
  })
}
`, 'utf8')
const probePatch = join(root, 'probe.patch.yml')
writeFileSync(probePatch, JSON.stringify([{ insert: [{ id: 'settings-e2e-probe', name: pathToFileURL(probePath).href }] }]), 'utf8')

const resultPath = join(root, 'probe.json')
const node = join(project, 'runtime-node', process.platform === 'win32' ? 'node.exe' : 'node')
const server = await startDsh({
  bootstrapPath: join(project, 'dist', 'src', 'runtime', 'dsh-bootstrap.mjs'),
  patches: [patch, probePatch],
  profileName: 'web',
  runtime: { root: join(project, 'runtime-dsh'), entry: join(project, 'runtime-dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js') },
  nodeExecutable: node,
  workingDirectory: root,
  environment: {
    DSH_HOME: home, DSH_PROFILE_DIR: profile, DSH_PROFILE_NAME: 'web',
    USERPROFILE: home, HOME: home, APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, '.config'),
    DSH_TELEMETRY_DISABLED: '1', SE_PROBE: resultPath,
  },
})

try {
  let probe
  for (let i = 0; i < 300; i += 1) {
    try { probe = JSON.parse(readFileSync(resultPath, 'utf8')) } catch { /* not yet */ }
    if (probe?.graph?.entries?.some(e => e.id === 'dsh-my-desktop-setting')) break
    await new Promise(r => setTimeout(r, 100))
  }
  const entry = (probe?.graph?.entries ?? []).find(e => e.id === 'dsh-my-desktop-setting')
  console.log('client roster entry:', entry ? 'present' : 'MISSING')
  if (entry?.url) {
    // Fetch the served bundle and check for our marker.
    const boot = await fetch(server.url, { redirect: 'manual' })
    const cookie = boot.headers.getSetCookie?.().map(v => v.split(';')[0]).join('; ') ?? ''
    await boot.body?.cancel()
    const res = await fetch(new URL(entry.url, server.url), { headers: { cookie } })
    const text = await res.text()
    console.log('served bundle is the upgraded copy:', text.includes(`UPGRADED-TO-${newer}`))
    const ok = text.includes(`UPGRADED-TO-${newer}`)
    console.log(ok ? '\nPASS: launcher runs the independently installed newer settings plugin' : '\nFAIL: served the baseline instead')
    if (!ok) process.exitCode = 1
  } else {
    console.log('\nFAIL: no client roster entry')
    process.exitCode = 1
  }
} finally {
  await server.stop().catch(() => {})
  rmSync(root, { recursive: true, force: true })
}
