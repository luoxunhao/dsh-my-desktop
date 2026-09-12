/**
 * Build every React-rendered launcher window.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The five shell windows cannot be built as multiple inputs of one Vite build.
 * Their documents are loaded over `file://`, so each bundle must be a classic
 * script (`format: 'iife'`), and Vite 8 (Rolldown) rejects IIFE with more than
 * one input:
 *
 *     Invalid value "false" for option "output.codeSplitting" -
 *     multiple inputs are not supported when "output.codeSplitting" is false.
 *
 * `format: 'iife'` implies `codeSplitting: false`, and there is no
 * `inlineDynamicImports` escape hatch in Rolldown. So each window is built by its
 * own Vite run, selected through `DSH_SHELL_ENTRY`, and this script drives them
 * in sequence.
 *
 * It also owns the one-time output cleanup. `emptyOutDir` is off in the Vite
 * config because five builds share one directory and wiping per-run would delete
 * the windows built before it — so the reset happens exactly once, here, before
 * the first build.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(projectRoot, 'dist', 'frontend', 'shell')
const assetsDir = join(projectRoot, 'assets')

/**
 * Every window to build, in order.
 *
 * Add a window here AND to `SHELL_ENTRIES` in `vite.config.ts`; the config is
 * what maps the name to an HTML entry, and it throws on an unknown name rather
 * than silently producing nothing.
 */
const ENTRIES = ['index', 'about', 'shortcuts', 'settings', 'startup']

/**
 * Static files the built documents reference by RELATIVE path.
 *
 * This matters because the documents are loaded from `dist/frontend/shell/`, so a
 * reference like `shell-icons/xmark.svg` resolves inside THAT directory — not in
 * `dist/` and not in `resources/`. Vite only rewrites the URLs it processes;
 * these are runtime strings (`<img src>` inside JSX, and the icon in
 * `startup.html`), so it leaves them alone and they must be copied to sit beside
 * the documents.
 *
 * `shell-icons/` holds the toolbar and caption glyphs; `icon.png` is the hero
 * image and the favicon.
 */
const RUNTIME_ASSETS = ['shell-icons', 'icon.png']

/** Resolve the local Vite binary so this does not depend on PATH or a global install. */
const viteBin = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')

function runVite(entry) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin, 'build'], {
      cwd: projectRoot,
      // `inherit` keeps Vite's own progress and diagnostics visible. The build
      // output is not captured or parsed, so there is nothing to pipe.
      stdio: 'inherit',
      env: { ...process.env, DSH_SHELL_ENTRY: entry },
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`构建 shell 入口 ${entry} 失败（退出码 ${code}）`))
    })
  })
}

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })

for (const entry of ENTRIES) {
  console.log(`\n==> shell-ui: ${entry}`)
  await runVite(entry)
}

// Copy the relative-path assets after the builds, since the builds no longer
// clear the directory (see `emptyOutDir` in vite.config.ts).
for (const asset of RUNTIME_ASSETS) {
  const from = join(assetsDir, asset)
  if (!existsSync(from)) throw new Error(`缺少 shell 运行期资源：${from}`)
  cpSync(from, join(outDir, asset), { recursive: true })
}

console.log(`\nshell-ui: 完成 ${ENTRIES.length} 个入口 -> dist/frontend/shell`)
