// Probe: boot DSH headless with the materialized dsh-my-desktop-setting overlay
// and confirm BOTH halves activate:
//  - HOST: /api/dsh-my-settings/state is registered (403 = same-origin guard, apply ran).
//  - CLIENT: the client-modules graph contains dsh-my-desktop-setting and its
//    client bundle is served as a __ModuleLoader__.load artifact (so the Settings
//    shell can register the "desktop settings" section).
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareDesktopSettings } from '../dist/src/desktop-settings-plugin.js'
import { startDsh } from '../dist/src/dsh-process.js'

const project = process.cwd()
const runtime = join(project, 'runtime-dsh')
const pluginRepo = process.env.DSH_SETTINGS_PLUGIN_REPO ?? join(project, 'plugins', 'desktop-settings')

const root = mkdtempSync(join(tmpdir(), 'dsh-settings-boot-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'web')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web', private: true, dependencies: {},
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}, undefined, 2) + '\n')
writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n', 'utf8')

const settingsPatch = prepareDesktopSettings(join(root, 'settings-plugin'), pluginRepo)
if (settingsPatch === undefined) throw new Error('settings plugin lib missing; run `pnpm run build:plugin` first')

// Inject a probe that records the client-modules graph + host loader rows.
const probePath = join(root, 'probe.mjs')
writeFileSync(probePath, `
import { writeFileSync } from 'node:fs'
export const name = 'dsh-settings-boot-probe'
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      const modules = ctx.get('clientModules')
      const loader = ctx.get('loader')
      const rows = []
      try { if (loader) for (const e of loader.entries()) rows.push({ name: e.options.name, state: e.fiber?.state, error: e.fiber?.error?.message }) } catch {}
      writeFileSync(process.env.DSH_SETTINGS_PROBE, JSON.stringify({ graph: modules?.graph?.() ?? undefined, rows }), 'utf8')
    }, 100)
    return () => clearInterval(timer)
  })
}
`, 'utf8')
const probePatch = join(root, 'probe.patch.yml')
writeFileSync(probePatch, JSON.stringify([{ insert: [{ id: 'dsh-settings-boot-probe', name: pathToFileURL(probePath).href }] }]), 'utf8')

const resultPath = join(root, 'probe.json')
const node = join(project, 'runtime-node', process.platform === 'win32' ? 'node.exe' : 'node')
const server = await startDsh({
  bootstrapPath: join(project, 'dist', 'src', 'dsh-bootstrap.mjs'),
  patches: [settingsPatch, probePatch],
  runtime: { root: runtime, entry: join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js') },
  nodeExecutable: node,
  workingDirectory: root,
  environment: {
    DSH_HOME: home, DSH_PROFILE_DIR: profile, DSH_PROFILE_NAME: 'web',
    DSH_PNPM_ENTRY: join(project, 'runtime-node', 'pnpm-package', 'bin', 'pnpm.cjs'),
    USERPROFILE: home, HOME: home, APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, '.config'),
    DSH_TELEMETRY_DISABLED: '1', DSH_USAGE_STATS: undefined, DSH_SETTINGS_PROBE: resultPath,
  },
})
try {
  let probe = undefined
  for (let i = 0; i < 400; i += 1) {
    try { probe = JSON.parse(readFileSync(resultPath, 'utf8')) } catch { /* not ready */ }
    const client = probe?.graph?.entries?.find(e => e.id === 'dsh-my-desktop-setting')
    const row = probe?.rows?.find(r => r.name === 'dsh-my-desktop-setting')
    if (client && row?.state === 2) break
    await new Promise(r => setTimeout(r, 100))
  }
  const client = probe?.graph?.entries?.find(e => e.id === 'dsh-my-desktop-setting')
  const clientServed = client?.url
    ? (await fetchWrapped(client.url, server.url))
    : false
  // Host: the plugin registers exact routes; 403 (same-origin guard) means the
  // host apply ran; 404 would mean it never registered.
  const hostStateStatus = await hostRouteStatus(server.url)
  console.log('clientGraphEntry:', JSON.stringify(client ?? null))
  console.log('clientServed(wrapped):', clientServed)
  console.log('hostStateRouteStatus:', hostStateStatus)
  const ok = client !== undefined && clientServed === true && hostStateStatus !== null && hostStateStatus !== 404
  console.log(ok
    ? 'PASS: plugin client.js in the client-modules graph (served wrapped) AND host apply registered /api/dsh-my-settings routes'
    : 'FAIL: see diagnostics above')
  if (!ok) process.exitCode = 1

async function fetchWrapped(urlPath, base) {
  const boot = await fetch(base, { redirect: 'manual' })
  const cookie = boot.headers.getSetCookie?.().map(v => v.split(';')[0]).join('; ') ?? ''
  await boot.body?.cancel()
  const res = await fetch(new URL(urlPath, base), { headers: { cookie } })
  const text = await res.text()
  return res.status === 200 && text.includes('window.__ModuleLoader__.load')
}
async function hostRouteStatus(base) {
  for (let i = 0; i < 150; i += 1) {
    try {
      const boot = await fetch(base, { redirect: 'manual' })
      const cookie = boot.headers.getSetCookie?.().map(v => v.split(';')[0]).join('; ') ?? ''
      await boot.body?.cancel()
      const res = await fetch(new URL('/api/dsh-my-settings/state', base), { headers: { cookie, accept: 'application/json' }, redirect: 'manual' })
      await res.body?.cancel()
      if (res.status !== 404) return res.status
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 200))
  }
  return null
}
} finally {
  await server.stop().catch(() => {})
  rmSync(root, { recursive: true, force: true })
}
