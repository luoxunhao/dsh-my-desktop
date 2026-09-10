/**
 * Type declarations for the recovery page's assets.
 *
 * `import './styles.css'` is a Vite build-time side effect with no runtime module,
 * so TypeScript needs to be told the import is valid. Without this the UI
 * typecheck fails on the stylesheet import.
 *
 * `vite/client` covers the common cases, but pulling it in wholesale also brings
 * `import.meta.env` typings the launcher does not otherwise use; the single
 * declaration below keeps the surface minimal.
 */
declare module '*.css' {
  const content: string
  export default content
}
