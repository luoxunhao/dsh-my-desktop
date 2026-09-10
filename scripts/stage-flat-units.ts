/**
 * Stage the two "flat publish units" that ship as standalone directories.
 *
 * Two artifacts are published FLAT — every member file sits in ONE directory and
 * imports its siblings as `./x.js`:
 *
 *   1. `resources/desktop-bridge/` — the host bridge injected into the DSH child
 *      process (see DESKTOP_BRIDGE_FILES in src/bridge/desktop-host.ts).
 *   2. `resources/` — the extraction script plus its runtime dependencies.
 *
 * Their SOURCES live in per-layer subdirectories (`dist/src/bridge/`,
 * `dist/src/infra/`, …), so the compiled output has cross-directory imports like
 * `../infra/process-control.js`. Those specifiers are correct for the layered
 * source tree but WRONG once the files are flattened into one directory.
 *
 * This step copies each unit's members into a flat staging directory and rewrites
 * their relative specifiers to sibling form (`./name.js`), so what gets packaged
 * is exactly what runs. Without it the packaged bridge would import paths that do
 * not exist next to it — a failure that only shows up at runtime.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Files published flat into `resources/desktop-bridge/`, with their source layers. */
const BRIDGE_LAYERS: Readonly<Record<string, string>> = {
  'desktop-bridge.mjs': 'bridge',
  'desktop-bridge-client-source.js': 'bridge',
  'desktop-host.js': 'bridge',
  'dsh-process.js': 'bridge',
  'atomic-file.js': 'infra',
  'process-control.js': 'infra',
  'readiness.js': 'infra',
  'runtime-archive.js': 'infra',
  'bundled-plugins.js': 'runtime',
  'plugin-toolchain.js': 'runtime',
  'runtime-prebuilt.js': 'runtime',
  'plugin-seed.js': 'profiles',
  'profile-updates.js': 'profiles',
  'profiles.js': 'profiles',
  'recovery-mode.js': 'recovery',
}

/** Files published flat into `resources/`, with their source layers. */
const EXTRACTION_LAYERS: Readonly<Record<string, string>> = {
  'extract-runtime.js': 'runtime',
  'runtime-archive.js': 'infra',
  'process-control.js': 'infra',
}

/**
 * Rewrite every relative specifier to a sibling `./name.js`.
 *
 * Safe here because each unit is self-contained by construction: every file it
 * imports is also a member, so flattening cannot orphan a specifier. We assert
 * that after rewriting, so a future member added without updating the map fails
 * the build instead of silently shipping a broken import.
 */
async function flattenUnit(files: Readonly<Record<string, string>>, destDir: string, sourceRoot: string): Promise<string[]> {
  await rm(destDir, { recursive: true, force: true })
  await mkdir(destDir, { recursive: true })
  const members = new Set(Object.keys(files))
  const written: string[] = []
  for (const [name, layer] of Object.entries(files)) {
    const from = join(sourceRoot, layer, name)
    let text = await readFile(from, 'utf8')
    const specifiers = [...text.matchAll(/from '(\.[^']+)'/g)].map(match => match[1]!)
    for (const spec of specifiers) {
      const base = spec.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
      const sibling = [...members].find(member => member.replace(/\.[^.]+$/, '') === base)
      if (sibling === undefined) {
        throw new Error(
          `扁平发布单元 ${destDir} 缺少依赖：${name} 引用了 ${spec}，`
          + `但 ${base} 不在成员列表里。请把该文件加入对应的 LAYERS 映射。`,
        )
      }
      text = text.replace(`from '${spec}'`, `from './${sibling}'`)
    }
    await writeFile(join(destDir, name), text, 'utf8')
    written.push(name)
  }
  return written
}

/** Stage `dist/bridge-flat/` — the flat desktop-bridge publish unit. */
export async function stageDesktopBridgeFlat(): Promise<string> {
  const dest = join(projectRoot, 'dist', 'bridge-flat')
  const written = await flattenUnit(BRIDGE_LAYERS, dest, join(projectRoot, 'dist', 'src'))
  console.log(`已扁平化桌面桥接发布单元：${dest}（${written.length} 个文件）`)
  return dest
}

/** Stage `dist/extract-flat/` — the flat extraction-script publish unit. */
export async function stageExtractionFlat(): Promise<string> {
  const dest = join(projectRoot, 'dist', 'extract-flat')
  const written = await flattenUnit(EXTRACTION_LAYERS, dest, join(projectRoot, 'dist', 'src'))
  console.log(`已扁平化解压脚本发布单元：${dest}（${written.length} 个文件）`)
  return dest
}

export async function stageFlatPublishUnits(): Promise<void> {
  await stageDesktopBridgeFlat()
  await stageExtractionFlat()
}

const self = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === self) {
  await stageFlatPublishUnits()
}
