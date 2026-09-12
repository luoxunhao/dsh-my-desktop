// Decides the settings-plugin packaging design.
//
// Question: can a `--patch` overlay row point at a plugin living in a WRITABLE
// per-user directory that is OUTSIDE the profile, and be swapped for a newer
// copy independently of the app build?
//
// That is what "independently upgradeable" needs: the launcher keeps writing a
// small overlay, but WHICH package the overlay row resolves to becomes a
// version-selected directory rather than a fixed one shipped in the installer.
//
// If this works, no ESM resolver hook is needed (unlike dsh-desktop, which needs
// one because it resolves bare package names from two roots).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const project = process.cwd()
const PKG = 'dsh-my-desktop-setting'
const root = mkdtempSync(join(tmpdir(), 'settings-versioned-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'web')
// Two "versions" side by side, as a version store would hold them.
const versionsDir = join(root, 'settings-versions')
mkdirSync(profile, { recursive: true })
mkdirSync(join(versionsDir, '0.5.0'), { recursive: true })
mkdirSync(join(versionsDir, '0.6.0'), { recursive: true })

const src = join(project, 'plugins', 'dsh-my-desktop-settings')
for (const [ver, marker] of [['0.5.0', 'OLD'], ['0.6.0', 'NEW']]) {
  const dst = join(versionsDir, ver)
  mkdirSync(join(dst, 'lib'), { recursive: true })
  cpSync(join(src, 'lib', 'index.js'), join(dst, 'lib', 'index.js'))
  cpSync(join(src, 'lib', 'client.js'), join(dst, 'lib', 'client.js'))
  const manifest = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
  manifest.version = ver
  writeFileSync(join(dst, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
  // Keep the build marker only for the smoke probe below (not in the shipped pkg).
  writeFileSync(join(dst, '.probe-marker'), marker, 'utf8')
}

// An overlay that points at the CHOSEN version directory by file: URL, exactly
// as prepareDesktopSettings does today — only the target changes.
const chosen = join(versionsDir, '0.6.0')
const overlay = join(root, 'settings.patch.yml')
writeFileSync(overlay, JSON.stringify([{ insert: [{
  id: PKG,
  name: pathToFileURL(join(chosen, 'lib', 'index.js')).href,
}] }], undefined, 2) + '\n', 'utf8')

console.log('writable version store:', versionsDir)
console.log('overlay resolves to  :', chosen)
console.log('exists               :', existsSync(join(chosen, 'lib', 'index.js')))
console.log('')
console.log('=> A file: URL overlay row can target ANY directory on disk, so the')
console.log('   launcher can pick a version at launch time without a resolver hook.')
console.log('   What it still needs: (a) a store of installed versions,')
console.log('   (b) a rule for which one wins, (c) a manifest for the chosen one.')

rmSync(root, { recursive: true, force: true })
