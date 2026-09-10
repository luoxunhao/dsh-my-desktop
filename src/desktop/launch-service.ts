/**
 * Shared skeleton for (re)launching the DSH child process.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three call sites used to repeat the same launch sequence by hand:
 *   1. first application start       (`startApplication`)
 *   2. recycle after a plugin update  (`recycleDshForPluginUpdate`)
 *   3. restart while in recovery mode (`restartDshInRecoveryMode`)
 *
 * WHAT IS ACTUALLY SHARED (measured, not assumed)
 * -----------------------------------------------
 * The three sites were reviewed line by line before extracting. Of ~13 steps only
 * these ARE common:
 *
 *   - `beginDshStartupDiagnostic(profileDir)`
 *   - `startWithProfileSelfRepair({ profileDir, extraDirs, start })` where `start`
 *     calls `startDsh` with the retained options plus the exit/IPC callbacks
 *   - assigning the returned server to `state.runtime.server`
 *   - `advanceDshStartupDiagnostic(profileDir, 'server-starting')`
 *
 * The rest legitimately DIFFERS and stays with each caller: the first start also
 * writes the smoke-ready file and schedules the startup update check; the recycle
 * path wraps plugin updates and persists their failure to `plugin-update.log`; the
 * recovery restart sets `allowedOrigin`, branches on `destination`, and rethrows.
 * Those differences are real behaviour, not duplication — this module deliberately
 * does NOT absorb them.
 *
 * DIAGNOSTIC TIMING (behaviour change, deliberate)
 * -----------------------------------------------
 * `beginDshStartupDiagnostic` used to sit INSIDE the `start` callback on the recycle
 * path, but outside it on the other two. The callback can run more than once (the
 * self-repair helper may retry), so the old placement could record the diagnostic
 * begin twice. It is now called once per launch here, matching the other two sites.
 */
import type { DshServer, StartDshOptions } from '../bridge/dsh-process.js'
import { startWithProfileSelfRepair } from '../profiles/profile-repair.js'
import type { RetainedStartOptions } from './desktop-state.js'

/** The result of one launch attempt: the running server plus any repaired plugins. */
export interface DshLaunchResult {
  server: DshServer
  /** Plugin names the self-repair helper removed to make the profile bootable. */
  repaired: readonly string[]
}

export interface DshLauncherDeps {
  /** Boot the child process with the retained options plus these callbacks. */
  startDsh: (options: StartDshOptions) => Promise<DshServer>
  /** Retained launch options, replayed on every restart. */
  startOptions: () => RetainedStartOptions | undefined
  /** Runtime directory that must stay resolvable for the profile's bundles. */
  desktopRuntimeDir: () => string | undefined
  /** Publish the fresh server handle so the rest of the app can reach it. */
  setServer: (server: DshServer) => void
  /**
   * Startup-diagnostic hooks. Injected rather than imported because they also update
   * `state.diagnostics.stage`, which belongs to the caller's store.
   */
  beginDiagnostic: (profileDir: string) => Promise<void>
  advanceDiagnostic: (profileDir: string, stage: 'server-starting') => Promise<void>
  onUnexpectedExit: (message: string) => void
  onIpcMessage: (message: unknown) => void
}

/**
 * Launch DSH once for `profileDir`, recording startup diagnostics around it.
 *
 * Ordering matters and is preserved from all three original sites: the server is
 * published BEFORE the diagnostic advances, so anything observing the diagnostic
 * (the renderer health timer, recovery UI) already sees a live server.
 *
 * Callers own everything before and after: stopping the previous server, applying
 * plugin updates, deciding which window to show, and how to handle failure.
 */
export async function launchDsh(
  deps: DshLauncherDeps,
  profileDir: string,
): Promise<DshLaunchResult> {
  const startOptions = deps.startOptions()
  if (startOptions === undefined) throw new Error('启动参数尚未准备完成，无法启动 DSH。')
  const desktopRuntimeDir = deps.desktopRuntimeDir()

  await deps.beginDiagnostic(profileDir)
  const started = await startWithProfileSelfRepair({
    profileDir,
    extraDirs: desktopRuntimeDir === undefined ? [] : [desktopRuntimeDir],
    start: () => deps.startDsh({
      ...startOptions,
      onUnexpectedExit: deps.onUnexpectedExit,
      onIpcMessage: deps.onIpcMessage,
    }),
  })
  deps.setServer(started.result)
  await deps.advanceDiagnostic(profileDir, 'server-starting')
  return { server: started.result, repaired: started.repaired }
}
