/**
 * Standalone tsdown config for dsh-my-desktop-setting.
 *
 * Emits two artifacts next to the Node half:
 *   - lib/index.js   (host/node half, emitted via the `node` config)
 *   - lib/client.js  (browser client bundle, the `client` config below)
 *
 * The client bundle reproduces the official DSH loader protocol
 * (mirrors deepseek-harness packages/client/tsdown.client.ts `clientConfig`):
 * it is wrapped in `window.__ModuleLoader__.load({ id, factory: (require) => … })`,
 * resolves module-table seeds through the injected `require` (declared external),
 * and inlines everything else. All `@deepseek-ai/dsh-client-*` imports in this
 * plugin are type-only and erased before bundling, so the only runtime externals
 * the factory needs are the framework rows the module table seeds.
 */
import { isBuiltin } from 'node:module'

const PLUGIN_ID = 'dsh-my-desktop-setting'

/**
 * Browser module-table rows the runtime provides. These must stay external
 * (a `require` the injected module table answers). The list is the subset a
 * settings client actually consumes at runtime.
 */
const PLATFORM_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-loader',
])

/** Everything that is NOT a requested external or a builtin must inline. */
const isRequestedExternal = (specifier: string): boolean => PLATFORM_EXTERNALS.has(specifier)

/** Reject cross-plugin value imports that are neither requested nor inline-safe. */
function purityGate(source: string): null {
  if (!source.startsWith('@deepseek-ai/')) return null
  if (isRequestedExternal(source)) return null
  // Type-only imports are erased before this point; any @deepseek-ai value
  // import reaching here is a cross-plugin value dependency the module table
  // cannot answer — a build error by design.
  throw new Error(
    `client bundle purity: "${source}" is not a module-table seed for ${PLUGIN_ID}. `
    + 'Cross-plugin value imports are forbidden; declare it as an external or '
    + 'collaborate through cordis services. (Type-only imports never reach this gate.)',
  )
}

export default [
  {
    name: PLUGIN_ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    fixedExtension: false,
    outputOptions: { entryFileNames: 'index.js' },
    deps: {
      // Keep Node builtins external (node:fs etc.); inline every project-local
      // module and any npm value dep so `lib/index.js` is self-contained.
      neverBundle: isBuiltin,
      alwaysBundle: (specifier: string) => !isBuiltin(specifier),
    },
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    deps: {
      neverBundle: isRequestedExternal,
      alwaysBundle: (specifier: string) => !isRequestedExternal(specifier),
    },
    plugins: [{ name: 'dsh-client-bundle-purity', resolveId: { handler: purityGate } }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
