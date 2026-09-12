/**
 * Type declarations for the shell windows' assets.
 *
 * `import './styles/bar.css'` is a Vite build-time side effect with no runtime
 * module, so TypeScript must be told the import is valid. Without this the
 * shell-ui typecheck fails on every stylesheet import.
 *
 * Kept as a single minimal declaration rather than pulling in `vite/client`
 * wholesale, which would also bring `import.meta.env` typings this code does not
 * use. Same reasoning as `frontend/recovery/env.d.ts`.
 */
declare module '*.css' {
  const content: string
  export default content
}
