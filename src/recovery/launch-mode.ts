/**
 * Deciding what a launch should do, before anything is started.
 *
 * MODELLED ON dsh-desktop's startup gate: it evaluates the one-shot markers on the
 * command line and, in recovery, opens the recovery assistant and RETURNS — the
 * plugin host is never started.
 *
 * WHY THIS IS A SEPARATE, PURE FUNCTION
 * -------------------------------------
 * This decision is the single most consequential branch in startup: choosing
 * "recovery" instead of "normal" is what lets a user repair an app whose host
 * cannot boot, and choosing it when it was not asked for would strand every launch
 * in the recovery assistant. It is therefore kept free of Electron and I/O so the
 * whole matrix can be tested directly.
 *
 * MARKERS ARE ONE-SHOT
 * --------------------
 * `desktopRecoveryRelaunchArguments` re-adds the marker on every relaunch, so a
 * naive implementation would re-enter recovery forever. The marker is only meant to
 * survive the single relaunch that set it; `relaunch-arguments.ts` drops it when
 * rebuilding a normal command line, and that is the mechanism that ends the loop.
 * This module only reads; it must never write the marker back.
 */
import {
  desktopRecoveryModeRequested,
  desktopSafeModeRequested,
} from './relaunch-arguments.js'

/** What the current launch should do. */
export type LaunchMode = 'normal' | 'recovery' | 'safe-mode'

export interface LaunchDecision {
  readonly mode: LaunchMode
  /** Whether the DSH host will be started. False only in recovery/safe mode. */
  readonly startsHost: boolean
  /**
   * Whether this launch should snapshot a healthy profile before starting.
   * Recovery and Safe Mode are diagnostic, so they must not overwrite a
   * checkpoint with a state the user is in the middle of repairing.
   */
  readonly capturesHealthyCheckpoint: boolean
}

/**
 * Resolve the launch mode from argv.
 *
 * Recovery wins over Safe Mode if both markers are somehow present: recovery is the
 * general-purpose repair path and supersedes the narrower isolated-environment mode.
 */
export function resolveLaunchDecision(argv: readonly string[] = process.argv): LaunchDecision {
  if (desktopRecoveryModeRequested(argv)) {
    return { mode: 'recovery', startsHost: false, capturesHealthyCheckpoint: false }
  }
  if (desktopSafeModeRequested(argv)) {
    return { mode: 'safe-mode', startsHost: false, capturesHealthyCheckpoint: false }
  }
  return { mode: 'normal', startsHost: true, capturesHealthyCheckpoint: true }
}

/** Whether a launch mode runs without the plugin host. */
export function skipsHost(mode: LaunchMode): boolean {
  return mode !== 'normal'
}
