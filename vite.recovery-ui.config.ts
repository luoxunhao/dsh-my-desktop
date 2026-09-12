import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Build config for the RECOVERY page.
 *
 * This is a separate config from `vite.config.ts` (which builds the shell
 * windows) because the two pages have genuinely different requirements:
 *
 *   - The recovery page is a SINGLE document built from `src/recovery-ui`, with
 *     Tailwind and the `@base-ui/react` primitives.
 *   - The shell windows are FIVE documents built from `src/shell-ui`, with
 *     hand-written CSS and no Tailwind.
 *
 * They previously shared one config, which worked only while the recovery page
 * was the sole React surface. Splitting them keeps each readable and means a
 * change to one page's entry list cannot silently alter the other's output.
 */

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

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
 * (2) is safe because the bundle is built as an IIFE: it has no top-level
 * `import`/`export` and no code splitting, so it is a plain classic script.
 *
 * The reference implementation needs neither because it serves the document over a
 * custom scheme rather than `file://`.
 */
function makeFileUrlLoadable(): Plugin {
  return {
    name: 'dsh-make-file-url-loadable',
    apply: 'build',
    closeBundle() {
      const indexPath = join(projectRoot, 'dist', 'recovery-ui', 'index.html')
      const html = readFileSync(indexPath, 'utf8')
      const patched = html
        .replace(/\s+crossorigin(?=[\s>])/g, '')
        .replace(/<script type="module"(\s)/g, '<script$1')
      if (patched !== html) writeFileSync(indexPath, patched)
    },
  }
}

/**
 * `base: './'` — the page is loaded from `file://` inside a packaged app, where
 * absolute asset URLs (`/assets/...`) resolve to the filesystem root and every
 * script 404s. Relative URLs are required.
 *
 * `outDir` under `dist/` — the launcher's own `tsc` output also lives there, and
 * `dist/` is gitignored, so the page is built rather than committed. `emptyOutDir`
 * is scoped to this subdirectory so a build never wipes the compiled launcher.
 *
 * React must stay a single copy: the launcher already depends on react 18.3.1, and
 * `dedupe` keeps any transitive copy from being bundled alongside it.
 */
export default defineConfig({
  root: join(projectRoot, 'src', 'recovery-ui'),
  base: './',
  plugins: [react(), tailwindcss(), makeFileUrlLoadable()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: join(projectRoot, 'dist', 'recovery-ui'),
    emptyOutDir: true,
    // Readable output: this ships in a desktop app, and a stack trace from a user's
    // machine is far more useful when it is not minified into one line.
    minify: false,
    sourcemap: false,
    /**
     * Output a CLASSIC script, not an ES module.
     *
     * This is the most important setting in this file. The launcher loads the page
     * with `loadFile`, i.e. over `file://`, and browsers REFUSE to execute
     * `<script type="module">` from a `file://` document — the request is treated as
     * CORS with an opaque origin and silently blocked. The document then loads, the
     * script never runs, and the window renders EMPTY with clean-looking HTML and no
     * console error.
     *
     * Verified empirically: a trivial `<script type="module" src="./m.js">` over
     * `file://` leaves its target unmodified in headless Chrome, while the classic
     * `<script>` form works. The launcher's pre-existing pages use classic scripts,
     * which is why they have always worked.
     *
     * The reference implementation sidesteps this by serving its recovery document
     * over a custom `dsh-recovery:` scheme. We keep `loadFile` (no new protocol
     * plumbing) and emit a classic bundle instead. The only cost is no code
     * splitting, which a single-window recovery page does not need.
     */
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
