import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

/** Entry points, keyed by the `DSH_SHELL_ENTRY` value that selects them. */
const SHELL_ENTRIES = {
  index: 'shell.html',
  about: 'about.html',
  shortcuts: 'shortcuts.html',
  settings: 'settings.html',
  startup: 'startup.html',
} as const

type ShellEntryName = keyof typeof SHELL_ENTRIES

/**
 * Which window this run builds.
 *
 * Throws on an unknown name rather than defaulting, so a typo in the build
 * script fails loudly instead of silently rebuilding the title bar five times.
 */
function resolveShellEntry(): ShellEntryName {
  const requested = process.env.DSH_SHELL_ENTRY ?? 'index'
  if (requested in SHELL_ENTRIES) return requested as ShellEntryName
  throw new Error(`未知的 shell 入口：${requested}（可选：${Object.keys(SHELL_ENTRIES).join(', ')}）`)
}

/**
 * Make the emitted document loadable over `file://`.
 *
 * Two adjustments, both required and both verified empirically:
 *
 * 1. Drop `crossorigin` from the injected tags. Over `file://` it turns the request
 *    into a CORS one with an opaque origin.
 * 2. Drop `type="module"` from the script tag. Browsers refuse to execute module
 *    scripts from a `file://` document, so the script silently never runs — the
 *    document renders EMPTY with clean-looking markup and no console error.
 *
 * (2) is safe because each bundle is built as an IIFE: it has no top-level
 * `import`/`export` and no code splitting, so it is a plain classic script.
 *
 * One document per run (see `DSH_SHELL_ENTRY`), so this patches exactly the file
 * that was just built.
 */
function makeFileUrlLoadable(): Plugin {
  return {
    name: 'dsh-make-file-url-loadable',
    apply: 'build',
    closeBundle() {
      const documentPath = join(projectRoot, 'dist', 'frontend', 'shell', SHELL_ENTRIES[resolveShellEntry()])
      if (!existsSync(documentPath)) return
      const html = readFileSync(documentPath, 'utf8')
      const patched = html
        .replace(/\s+crossorigin(?=[\s>])/g, '')
        .replace(/<script type="module"(\s)/g, '<script$1')
      if (patched !== html) writeFileSync(documentPath, patched)
    },
  }
}

/**
 * Build config for every React-rendered launcher window.
 *
 * ONE BUILD PER WINDOW, ORCHESTRATED BY `build:shell-ui`
 * -----------------------------------------------
 * The title bar, about, shortcuts, settings and startup windows are all React
 * now (sources under `frontend/shell/`), and they share a bridge layer, a theme
 * contract and a set of primitives.
 *
 * They CANNOT be built as multiple inputs of one Vite build, which is worth
 * spelling out because it is not obvious. The documents are loaded over
 * `file://`, so each bundle must be a CLASSIC script (`format: 'iife'`), and
 * Vite 8 — which bundles with Rolldown — rejects IIFE with more than one input:
 *
 *     Invalid value "false" for option "output.codeSplitting" -
 *     multiple inputs are not supported when "output.codeSplitting" is false.
 *
 * `format: 'iife'` implies `codeSplitting: false`, and Rolldown has no
 * `inlineDynamicImports` to override it. Multiple entries with ES-module output
 * would emit shared chunks that a classic script cannot load.
 *
 * So the build runs once per window, driven by `DSH_SHELL_ENTRY` (see
 * `build:shell-ui` in package.json). Each run is a single-entry, self-contained
 * IIFE. The shared source modules are compiled once per window rather than once
 * overall — a few hundred KB of duplication in a local desktop app, traded for
 * bundles that actually load over `file://`.
 *
 * TWO SETTINGS THAT ARE NOT DEFAULTS, AND WHY
 * -------------------------------------------
 * `base: './'` — the documents are loaded from `file://` inside a packaged app,
 * where absolute asset URLs (`/assets/...`) resolve to the filesystem root and
 * every script 404s. Relative URLs are required.
 *
 * `outDir` under `dist/` — the launcher's own `tsc` output also lives there, and
 * `dist/` is gitignored, so these pages are built rather than committed.
 * `emptyOutDir` is FALSE because five sequential builds share one output
 * directory: wiping it on each run would delete the four windows built before
 * it. `build:shell-ui` clears the directory once, up front.
 *
 * React must stay a single copy: the launcher already depends on react 18.3.1,
 * and `dedupe` keeps any transitive copy from being bundled alongside it.
 */

const shellEntry = resolveShellEntry()

export default defineConfig({
  root: join(projectRoot, 'frontend', 'shell'),
  base: './',
  plugins: [react(), tailwindcss(), makeFileUrlLoadable()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: join(projectRoot, 'dist', 'frontend', 'shell'),
    // Five builds share this directory; see the note above.
    emptyOutDir: false,
    // Readable output: this ships in a desktop app, and a stack trace from a user's
    // machine is far more useful when it is not minified into one line.
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: join(projectRoot, 'frontend', 'shell', SHELL_ENTRIES[shellEntry]),
      output: {
        format: 'iife',
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
