// Would dsh-my-desktop-setting actually work if installed the same way as
// dsh-quote / dsh-codex-project (vendored artifact → offline store → profile
// bundle)? Read the code says "no, prune would drop it" — this checks whether
// that is still true, since the code has changed since the comment was written.
//
// Method: build the profile-bundle scenario end to end and run the real
// lifecycle functions against it, then report what actually happens.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const project = process.cwd()
const { reconcileProfileBundles, pruneMissingProfileBundles, finalizeProfileBundlesAfterInstall, planBundledPluginSeed, ensureProfileScaffold } =
  await import(pathToFileURL(join(project, 'dist', 'src', 'profiles', 'plugin-seed.js')).href)
const { pnpmStoreRoot } = await import(pathToFileURL(join(project, 'dist', 'src', 'profiles', 'plugin-seed.js')).href)

const PKG = 'dsh-my-desktop-setting'
const root = mkdtempSync(join(tmpdir(), 'settings-as-bundle-'))
const profile = join(root, 'profiles', 'web')
mkdirSync(profile, { recursive: true })
await ensureProfileScaffold(profile, 'web')

// Simulate the plugin having been installed into the profile like a community
// plugin would be: node_modules/<name> with its manifest + built lib.
const installed = join(profile, 'node_modules', PKG)
mkdirSync(join(installed, 'lib'), { recursive: true })
cpSync(join(project, 'plugins', 'dsh-my-desktop-settings', 'lib', 'index.js'), join(installed, 'lib', 'index.js'))
cpSync(join(project, 'plugins', 'dsh-my-desktop-settings', 'lib', 'client.js'), join(installed, 'lib', 'client.js'))
cpSync(join(project, 'plugins', 'dsh-my-desktop-settings', 'cordis.patch.yml'), join(installed, 'cordis.patch.yml'))
writeFileSync(join(installed, 'package.json'), readFileSync(join(project, 'plugins', 'dsh-my-desktop-settings', 'package.json')), 'utf8')

// Declare it the way an install would.
const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
manifest.dependencies = { ...(manifest.dependencies ?? {}), [PKG]: 'file:...' }
writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')

const readBundles = () => {
  const m = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  return { deps: Object.keys(m.dependencies ?? {}), bundles: m.dsh?.profile?.bundles ?? [] }
}

console.log('0. after install declaration:')
console.log('   deps   :', readBundles().deps.join(', '))

// Does the seed planner even consider it? It only iterates the catalog.
const plan = planBundledPluginSeed({
  catalog: [{ packageName: PKG, version: '0.5.0' }],
  declaredPackages: readBundles().deps,
  installedPackages: [PKG],
  storeExists: true,
})
console.log('1. planBundledPluginSeed:', plan.action, plan.reason ?? '')

// Would reconcile add it to bundles? (needs dsh.bundle.patch + resolvable file)
const bundles = await reconcileProfileBundles(profile)
console.log('2. reconcileProfileBundles ->', readBundles().bundles.join(', '))
console.log('   includes setting plugin:', readBundles().bundles.includes(PKG))

// The documented killer: prune drops anything not in dependencies / not resolvable.
const removed = await pruneMissingProfileBundles(profile)
console.log('3. pruneMissingProfileBundles removed:', removed.length ? removed.join(', ') : '(none)')
const afterPrune = readBundles()
console.log('   bundles after prune:', afterPrune.bundles.join(', '))
console.log('   still declared as dep:', afterPrune.deps.includes(PKG))

// And the full finalize path the launcher actually calls before boot.
await finalizeProfileBundlesAfterInstall(profile, [])
const final = readBundles()
console.log('4. after finalizeProfileBundlesAfterInstall:')
console.log('   deps   :', final.deps.join(', ') || '(none)')
console.log('   bundles:', final.bundles.join(', '))
console.log('   SURVIVES as bundle:', final.bundles.includes(PKG))

rmSync(root, { recursive: true, force: true })
