// Final proof against the REAL installed app layout.
//
// Uses the actual on-disk store and a real profile that records the v11 storeDir,
// then asserts the seed spec resolves to a file that EXISTS. This is the exact
// check that would have caught the "installed but plugin missing" bug.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const project = process.cwd()
const installDir = 'D:\\Program Files\\DSH My Desktop'
const storeRoot = join(installDir, 'plugins', 'store')
const home = join(process.env.USERPROFILE, '.dsh')
const profile = join(home, 'profiles', 'dsh-my-desktop')

const { resolvePnpmStoreDir, buildSeedPluginArgs } = await import(pathToFileURL(join(project, 'dist', 'src', 'profiles', 'plugin-seed.js')).href)
const { BUNDLED_PLUGINS } = await import(pathToFileURL(join(project, 'dist', 'src', 'runtime', 'bundled-plugins.js')).href)

const codex = BUNDLED_PLUGINS.find(p => p.vendorTarball !== undefined)
console.log('profile        :', profile, '(exists:', existsSync(profile) + ')')
console.log('modules.yaml   :', existsSync(join(profile, 'node_modules', '.modules.yaml')))

const recorded = JSON.parse(readFileSync(join(profile, 'node_modules', '.modules.yaml'), 'utf8')).storeDir
console.log('recorded store :', recorded)

const derived = resolvePnpmStoreDir(profile, storeRoot)
console.log('derived store  :', derived)

const spec = buildSeedPluginArgs([codex], profile, { storeDir: derived, offline: true })[1]
const specPath = spec.replace(/^file:/, '').replaceAll('/', '\\')
console.log('seed spec      :', spec)
console.log('spec file there:', existsSync(specPath))

const ok = existsSync(specPath) && derived === storeRoot
console.log(ok ? '\nPASS: the installed app can now seed the bundled plugin' : '\nFAIL: artifact still unreachable')
if (!ok) process.exitCode = 1
