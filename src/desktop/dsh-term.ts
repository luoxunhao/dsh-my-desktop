/**
 * Terminal `dsh` shim argv rewriting.
 *
 * DSH My Desktop is a single-profile launcher for the `web` profile. Its
 * terminal exposes a `dsh` shim so `dsh`, `dsh plugin …`, `dsh --dump-config`
 * and `dsh web …` act on the active profile without the user typing
 * `--profile web` every time.
 *
 * The naive approach — prepending `--profile <name>` to the front of argv —
 * breaks `dsh plugin`: the official CLI's `plugin` subcommand requires its own
 * `--profile` and explicitly rejects a parent-level `--profile` (see
 * `@deepseek-ai/dsh` `apps/cli/src/args.ts`). Prepending puts the flag on the
 * parent, so `dsh plugin add <pkg>` either fails with "required option
 * '--profile <name>' not specified" (flag eaten by the parent) or, when the
 * user repeats it, with "plugin takes none of parent --profile…".
 *
 * The reference DSH Desktop launcher solves this by rewriting argv in a thin
 * Node entry (`desktop-cli.ts` `withDefaultDesktopProfile`): leave an explicit
 * `--profile` alone, do not touch the `web`/`--help`/`--version` aliases, and
 * for a `plugin` subcommand insert `--profile <name>` *after* `plugin` so the
 * flag lands on the subcommand, not the parent. This module mirrors that
 * behaviour and emits the self-contained ESM wrapper the terminal shim runs.
 *
 * @module @deepseek-ai/dsh-my-desktop/dsh-term
 */

/**
 * Rewrite the arguments a user typed into the profile-scoped `dsh` so they
 * resolve against the active profile, mirroring the reference desktop-terminal
 * shim. Pure and side-effect free so the decision is unit-testable.
 * @param args - the user's arguments, in order (never the node/binary prefix).
 * @param profileName - the launcher's single profile (e.g. `web`).
 * @returns the argv to hand the official CLI (still without the node/binary prefix).
 */
export function rewriteProfileInvocation(args: readonly string[], profileName: string): string[] {
  // An explicit --profile (however placed before a subcommand) already selects a
  // profile; do not fight it.
  if (args.some(argument => argument === '--profile' || argument.startsWith('--profile='))) return [...args]
  const first = args[0]
  // Aliases and introspection commands that do not need — or must not get — the
  // injected profile (the `web` subcommand and `plugin` both reject a parent one).
  if (first === 'web' || first === '--help' || first === '-h' || first === '--version' || first === '-V') {
    return [...args]
  }
  // `dsh plugin …`: place the profile on the plugin subcommand, never the parent.
  if (first === 'plugin') return ['plugin', '--profile', profileName, ...args.slice(1)]
  // Bare `dsh`, `dsh --dump-config`, `dsh <inner app args>`: boot the profile.
  return ['--profile', profileName, ...args]
}

/**
 * Emit the self-contained ESM wrapper the `dsh` terminal shim executes.
 *
 * It runs under the bundled Node with argv `node dsh-term.mjs <user args…>`,
 * rewrites those args against the active profile, then dynamic-imports the
 * official CLI entry so commander sees a parent-free argv for `plugin`/`web`.
 * @param profileName - the launcher's single profile.
 * @param binJsPath - absolute path to `@deepseek-ai/dsh/lib/bin.js`.
 * @returns the ESM module source to write next to the terminal shim.
 */
export function renderTerminalEntry(profileName: string, binJsPath: string): string {
  const profileLiteral = JSON.stringify(profileName)
  const entryLiteral = JSON.stringify(binJsPath)
  return [
    'import { pathToFileURL } from \'node:url\'',
    `const profileName = ${profileLiteral}`,
    `const entry = ${entryLiteral}`,
    'const userArgs = process.argv.slice(2)',
    'const args = userArgs.some(a => a === \'--profile\' || a.startsWith(\'--profile=\'))',
    '  ? userArgs',
    '  : userArgs[0] === \'web\' || userArgs[0] === \'--help\' || userArgs[0] === \'-h\' || userArgs[0] === \'--version\' || userArgs[0] === \'-V\'',
    '    ? userArgs',
    '    : userArgs[0] === \'plugin\'',
    '      ? [\'plugin\', \'--profile\', profileName, ...userArgs.slice(1)]',
    '      : [\'--profile\', profileName, ...userArgs]',
    'process.argv = [process.execPath, entry, ...args]',
    // DSH 0.1.5 guards its CLI with `if (import.meta.main) await runCli()`.
    // Importing the entry as a module leaves that guard false (this wrapper is
    // the main module), so runCli never ran: `dsh --version` exited 0 with ZERO
    // output — silent, no error, exactly what the terminal showed. The CLI
    // exports runCli for embedded launches, so call it explicitly; 0.1.2-era
    // entries have no export and already ran themselves during the import.
    'const mod = await import(pathToFileURL(entry).href)',
    'if (typeof mod.runCli === \'function\') await mod.runCli()',
    '',
  ].join('\n')
}
