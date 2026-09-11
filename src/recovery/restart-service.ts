/**
 * Restart orchestration: confirmation, idempotency, and relaunch ordering.
 *
 * MODELLED ON dsh-desktop's `requestRecoveryRestart` + `confirmAndRestart`
 * (electron-runtime.ts).
 *
 * WHY THESE ARE INJECTED RATHER THAN IMPORTED
 * -------------------------------------------
 * This module must be testable under plain `node`, but `electron` cannot be
 * imported outside an Electron process — and this repo has no Electron mock
 * infrastructure. So every Electron touchpoint (`app.relaunch`, `app.exit`,
 * `dialog.showMessageBox`) arrives as a callback, and the module itself imports
 * nothing from `electron`. `main.ts` supplies the real ones.
 *
 * WHAT CHANGES
 * ------------
 * Recovery used to be entered IN-PROCESS: the DSH child was restarted and an
 * isolation flag was written into the profile. That cannot help when the app
 * itself will not start, and it is not what the reference does. Now entering
 * recovery relaunches the WHOLE application with a one-shot marker
 * (see `relaunch-arguments.ts`); the new process reads it and boots the recovery
 * assistant instead of the plugin host.
 *
 * THREE PROPERTIES THAT MATTER
 * ----------------------------
 * 1. **Confirmation first** — entering recovery kills the running session, so the
 *    user confirms, and the dialog defaults to Cancel.
 * 2. **Idempotent** — a double-click must not queue two relaunches.
 * 3. **Relaunch BEFORE exit** — reversing them exits the app with nothing
 *    scheduled to replace it, which looks exactly like a crash.
 */
import { desktopRecoveryRelaunchArguments, desktopSafeModeRelaunchArguments } from './relaunch-arguments.js'
import { restartConfirmationCopy, type RestartTarget } from './restart-confirmation.js'

/** The subset of Electron's message box options we actually set. */
export interface RestartMessageBoxOptions {
  readonly type: 'question'
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly buttons: readonly string[]
  readonly defaultId: number
  readonly cancelId: number
  readonly noLink: boolean
}

export interface RestartDeps {
  /** Current UI locale, for the confirmation copy. */
  locale: () => string
  /** Register the next launch. Called with extra args, or none for a plain restart. */
  relaunch: (args?: string[]) => void
  /** End this process. */
  exit: (code: number) => void
  /** Shut the shell down in order, then run the given action. */
  shutdown: (action: () => void) => Promise<void>
  /** Current argv, so the relaunch preserves existing arguments. */
  argv: () => readonly string[]
  /** Show the confirmation; returns the chosen button index. */
  confirm: (options: RestartMessageBoxOptions) => Promise<{ response: number }>
}

export function createRestartService(deps: RestartDeps) {
  /** Shared in-flight request, so concurrent callers await the same relaunch. */
  let inFlight: Promise<void> | undefined
  /** Once true the relaunch is registered and must not be repeated. */
  let restartRequested = false

  /** Register the relaunch, then exit. Call order is load-bearing. */
  async function relaunchWith(args: string[] | undefined): Promise<void> {
    if (restartRequested) return
    restartRequested = true
    deps.relaunch(args)
    // Exit only AFTER relaunch is registered — the reverse leaves the app gone
    // with nothing scheduled to replace it.
    await deps.shutdown(() => deps.exit(0))
  }

  async function confirmAndRestart(target: RestartTarget): Promise<void> {
    // Once a relaunch is registered the app is tearing down, so a late request
    // (a second tray click during shutdown) must not reopen the dialog. The
    // reference gets this from its `quitting` flag; we check the relaunch flag
    // itself, which is set at the same point.
    if (restartRequested) return
    const copy = restartConfirmationCopy(deps.locale(), target)
    const result = await deps.confirm({
      type: 'question',
      title: copy.title,
      message: copy.message,
      detail: copy.detail,
      buttons: [...copy.buttons],
      defaultId: copy.defaultId,
      cancelId: copy.cancelId,
      noLink: true,
    })
    // Only the confirm button proceeds; anything else (including dismissal) aborts.
    if (result.response !== 0) return
    await relaunchWith(
      target === 'recovery'
        ? desktopRecoveryRelaunchArguments([...deps.argv()])
        : target === 'safe-mode'
          ? desktopSafeModeRelaunchArguments([...deps.argv()])
          : undefined,
    )
  }

  /** Restart into recovery mode, after asking the user. */
  async function requestRecoveryRestart(): Promise<void> {
    if (inFlight !== undefined) return await inFlight
    const request = confirmAndRestart('recovery').finally(() => {
      if (inFlight === request) inFlight = undefined
    })
    inFlight = request
    await request
  }

  /** Ordinary restart, after asking the user. */
  async function requestRestart(): Promise<void> {
    if (inFlight !== undefined) return await inFlight
    const request = confirmAndRestart('normal').finally(() => {
      if (inFlight === request) inFlight = undefined
    })
    inFlight = request
    await request
  }

  /** Whether a relaunch has already been registered. */
  function isRestartRequested(): boolean {
    return restartRequested
  }

  /** Restart into the disposable Safe Mode environment, after asking the user. */
  async function requestRecoverySafeModeRestart(): Promise<void> {
    if (inFlight !== undefined) return await inFlight
    const request = confirmAndRestart('safe-mode').finally(() => {
      if (inFlight === request) inFlight = undefined
    })
    inFlight = request
    await request
  }

  return { requestRecoveryRestart, requestRecoverySafeModeRestart, requestRestart, isRestartRequested }
}

export type RestartService = ReturnType<typeof createRestartService>
