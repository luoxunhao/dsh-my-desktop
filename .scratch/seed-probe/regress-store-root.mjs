// Regression check against the REAL failing deployment shape.
//
// The user's installed app has the store laid out as:
//   D:\Program Files\DSH My Desktop\plugins\store\   <- store ROOT
//     ├─ v11/                 (pnpm's own layout dir)
//     ├─ vendor-tarballs/     (our artifact)
//     └─ cache/
// while the profile's .modules.yaml records `storeDir = <root>/v11`.
//
// This reproduces exactly that: seed a profile that already recorded a v11 store,
// then assert the vendored artifact is resolvable from the path the seed derives.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const project = process.cwd()
const { resolvePnpmStoreDir, buildSeedPluginArgs } = await import(pathToFileURL(join(project, 'dist', 'src', 'profiles', 'plugin-seed.js')).href)
const { BUNDLED_PLUGINS } = await import(pathToFileURL(join(project, 'dist', 'src', 'runtime', 'bundled-plugins.js')).href)

const root = mkdtempSync(join(tmpdir(), 'codex-regress-'))
const profile = join(root, 'home', 'profiles', 'dsh-my-desktop')
const storeRoot = join(root, 'plugins', 'store')
mkdirSync(join(profile, 'node_modules'), { recursive: true })
mkdirSync(join(storeRoot, 'v11'), { recursive: true })
mkdirSync(join(storeRoot, 'vendor-tarballs'), { recursive: true })

// The artifact, exactly as prepare-runtime places it.
const codex = BUNDLED_PLUGINS.find(p => p.vendorTarball !== undefined)
const artifactName = 'luoxunhao-dsh-codex-project-0.12.0.tgz'
cpSync(join(project, codex.vendorTarball), join(storeRoot, 'vendor-tarballs', artifactName))

// pnpm's record: the VERSIONED dir, which is what actually broke the seed.
writeFileSync(
  join(profile, 'node_modules', '.modules.yaml'),
  JSON.stringify({ storeDir: join(storeRoot, 'v11'), packageManager: 'pnpm@11.24.0' }),
  'utf8',
)
writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-dsh-my-desktop', private: true, dependencies: {} }), 'utf8')

// 1. The derived store dir must be the ROOT, so artifacts beside v11 are reachable.
const derived = resolvePnpmStoreDir(profile, storeRoot)
console.log('recorded storeDir :', join(storeRoot, 'v11'))
console.log('derived  storeDir :', derived)
console.log('derived === root  :', derived === storeRoot)
console.log('artifact reachable:', existsSync(join(derived, 'vendor-tarballs', artifactName)))

// 2. The seed spec must therefore point at a file that exists.
const spec = buildSeedPluginArgs([codex], profile, { storeDir: derived, offline: true })[1]
console.log('seed spec         :', spec)
const specPath = spec.replace(/^file:/, '').replaceAll('/', process.platform === 'win32' ? '\\' : '/')
console.log('spec file exists  :', existsSync(specPath))

const ok = derived === storeRoot && existsSync(specPath)
console.log(ok ? '\nPASS: artifact resolvable in the exact layout that failed' : '\nFAIL: see above')
if (!ok) process.exitCode = 1
rmSync(root, { recursive: true, force: true })
