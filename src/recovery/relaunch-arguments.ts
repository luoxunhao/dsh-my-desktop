/**
 * One-shot launch markers used to enter recovery mode before the DSH host boots.
 *
 * MODELLED DIRECTLY ON dsh-desktop's `relaunch-arguments.ts` (kept deliberately
 * close, including names, so the two stay comparable).
 *
 * WHY A PROCESS MARKER
 * --------------------
 * Recovery mode is a property of a *new generation* of the app, not a flag inside
 * the running one. Entering it means relaunching the whole Electron application
 * with a marker on the command line; the new process reads that marker during
 * startup and skips booting the DSH host entirely, showing the recovery window
 * instead. That is the opposite of an in-process flag, and it is what makes
 * recovery available even when the host cannot start at all.
 *
 * ONE-SHOT SEMANTICS
 * ------------------
 * `defaultRelaunchArguments` REBUILDS the command line while dropping both markers.
 * That is what stops the next normal restart from silently re-entering recovery:
 * the marker only survives the single relaunch that added it.
 *
 * Detection uses exact membership over `argv.slice(1)` — never a prefix test — so a
 * lookalike argument such as `--dsh-desktop-recovery-extra` cannot trigger it.
 */

/** Process marker selecting recovery mode for one generation. */
export const DESKTOP_RECOVERY_MODE_ARGUMENT = '--dsh-desktop-recovery'
/** Process marker selecting the disposable Safe Mode DSH environment. */
export const DESKTOP_SAFE_MODE_ARGUMENT = '--dsh-desktop-safe-mode'

/** Rebuild the current Electron command line without retaining one-shot modes. */
export function desktopDefaultRelaunchArguments(argv: readonly string[] = process.argv): string[] {
  return argv.slice(1).filter(argument => argument !== DESKTOP_RECOVERY_MODE_ARGUMENT
    && argument !== DESKTOP_SAFE_MODE_ARGUMENT)
}

/** Build a one-shot recovery-mode command line. */
export function desktopRecoveryRelaunchArguments(argv: readonly string[] = process.argv): string[] {
  return [...desktopDefaultRelaunchArguments(argv), DESKTOP_RECOVERY_MODE_ARGUMENT]
}

/** Detect an explicit recovery-mode launch without accepting prefix variants. */
export function desktopRecoveryModeRequested(argv: readonly string[] = process.argv): boolean {
  return argv.slice(1).includes(DESKTOP_RECOVERY_MODE_ARGUMENT)
}

/** Build a one-shot command line that boots against the isolated Safe Mode home. */
export function desktopSafeModeRelaunchArguments(argv: readonly string[] = process.argv): string[] {
  return [...desktopDefaultRelaunchArguments(argv), DESKTOP_SAFE_MODE_ARGUMENT]
}

/** Detect only the exact Safe Mode argument, never a prefix variant. */
export function desktopSafeModeRequested(argv: readonly string[] = process.argv): boolean {
  return argv.slice(1).includes(DESKTOP_SAFE_MODE_ARGUMENT)
}
