/**
 * The recovery flow: entering it, showing the assistant, and leaving it again.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * This was the last large cluster in `main.ts` — the original issue called it out as
 * the hardest to extract because it is tangled with the startup orchestration in BOTH
 * directions:
 *
 *   recovery → orchestration   it restarts the DSH child, which is a launch concern
 *   orchestration → recovery   startup must decide whether to open the workbench or
 *                              the recovery assistant
 *
 * Neither direction can be an `import` without a cycle, so the outward edges arrive
 * as callbacks (the same rule used for the tray/updater and the dialog windows). The
 * module OWNS the recovery state transitions and the window, and ASKS for everything
 * else.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN
 * ---------------------------------
 * Launching DSH. `launchDsh` already exists as its own module with its own narrow
 * signature; recovery calls it through an injected `startDshChild` so this module
 * never has to know how a child is spawned.
 */
import { app } from 'electron'

import { DESKTOP_APP_NAME } from '../app/app-identity.js'
import { projectCheckpointSlots, type ProjectedCheckpointSlot } from './renderer-views.js'
import { resolveDataDirectory } from './data-directory.js'
import { createDesktopProfileCheckpoint, DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS, type DesktopProfileCheckpointSlotId } from './profile-checkpoint.js'
import {
  getRecoveryStatus,
  isRecoveryModeActive,
  leaveRecoveryMode,
  restoreRecoveryPlugin,
  tryAutoLeaveRecoveryMode,
  uninstallRecoveryPlugin,
  type RecoveryStatus,
} from './recovery-mode.js'
import type { RecoveryOpenTarget } from './open-targets.js'
import { DATA_DIRECTORY_ACTIONS, FACTORY_RESET_ACTIONS, OPEN_TARGET_ACTIONS, type RecoveryActionId } from './recovery-actions.js'

/** The store slice recovery reads and writes. */
export interface RecoveryStateSlice {
  profileDir: string | undefined
  failureMessage: string | undefined
  failurePlugin: string | undefined
  failurePlugins: string[]
}

export interface RecoveryDeps {
  /** Recovery-owned store slice. */
  recovery: RecoveryStateSlice
  /** Read-only neighbours, accessed through callbacks to keep this module decoupled. */
  server: () => { url: string, stop: () => Promise<void> } | undefined
  mainWindow: () => { isDestroyed: () => boolean, isMaximized: () => boolean, unmaximize: () => void, setMinimumSize: (w: number, h: number) => void, setSize: (w: number, h: number) => void, center: () => void, maximize: () => void, show: () => void, focus: () => void } | undefined
  /** Ensure the main window exists and return it. */
  createWindow: () => NonNullable<ReturnType<RecoveryDeps['mainWindow']>>
  /** The recovery content view. */
  recoveryView: () => { webContents: Electron.WebContents }
  /** The DSH content view. */
  dshView: () => { webContents: Electron.WebContents }
  /** Show the DSH view / the recovery view respectively. */
  showDshContentView: () => void
  showRecoveryContentView: () => void
  /**
   * Navigate a view, guarding against a stale in-flight navigation.
   *
   * Returns whether the navigation was actually applied: a rapid theme change can
   * supersede an in-flight load, and the coordinator reports that rather than
   * letting the stale navigation win. The recovery flow does not need the answer, so
   * it is discarded — but the signature must accept it.
   */
  navigate: (view: { webContents: Electron.WebContents }, load: () => Promise<void>) => Promise<unknown>
  /** Load a file into a webContents with query parameters. */
  loadFile: (contents: Electron.WebContents, path: string, query: Record<string, string>) => Promise<void>
  /** Load an HTTP(S) URL — the workbench is a live server, NOT a file on disk. */
  loadURL: (contents: Electron.WebContents, url: string) => Promise<void>
  /** Resolve the built recovery page, or undefined when it was never built. */
  resolveRecoveryHtml: () => string | undefined
  /** Current shell colour scheme and locale, read at open time. */
  theme: () => { colorScheme: string, locale: string }
  /** Whether this launch was a user-requested recovery entry. */
  recoveryRequested: () => boolean
  /** Whether THIS generation runs in the disposable Safe Mode environment. */
  safeModeRequested: () => boolean
  /** Create the main window pointed at a running server. */
  createMainWindow: (serverUrl: string) => Promise<void>
  /** Tell every shell renderer that the recycle state changed. */
  broadcastShellState: () => void
  /** Mark a DSH restart in progress and report whether one already was. */
  setRecycling: (value: boolean) => void
  /** Launch (or relaunch) the DSH child against a profile. */
  startDshChild: (profileDir: string) => Promise<void>
  /** Set the server handle and update the origin guard, in that order. */
  adoptServer: (server: { url: string }) => void
  /** Drop the current server handle, returning it so the caller can stop it. */
  releaseServer: () => { url: string, stop: () => Promise<void> } | undefined
  /** Recording and renderer-health hooks used while entering the workbench. */
  advanceDiagnostic: (profileDir: string, stage: 'renderer-loading') => Promise<void>
  startRendererHealthTimer: (profileDir: string) => void
  stopRendererHealthTimer: () => void
  reportStartupFailure: (error: unknown, profileDir: string) => Promise<void>
  /** Keep the profile watcher in sync after a restart. */
  syncProfileWatcher: () => void
  /** Launcher-resolved harness home, for the checkpoint manager. */
  homeDir: () => string
  /** Managed profiles, for the profile panel. */
  listProfiles: () => readonly unknown[]
  /** Open an allowlisted config file/directory in the OS. */
  openTarget: (target: RecoveryOpenTarget, profileDir: string) => Promise<void>
  /** Read the startup error log for a profile. */
  readStartupLog: (profileDir: string) => Promise<string>
  /** Truncate a long log for display. */
  trimStartupLog: (content: string) => string
  /** Open a path in the OS; resolves with '' on success. */
  openPath: (path: string) => Promise<string>
  /** Reset the DSH home, moving it to the trash. */
  factoryReset: (profileDir: string) => Promise<void>
  /** Current data-directory location, for the data panel. */
  dataDirectory: () => ReturnType<typeof resolveDataDirectory>
  /** Persist a chosen data directory, or clear it with null. */
  selectDataDirectory: (target: string | null) => void
  /** Relaunch the whole application into the disposable Safe Mode environment. */
  requestSafeModeRestart: () => Promise<void>
  /** Collect a local diagnostics bundle; resolves with the file name. */
  exportDiagnostics: (profileDir: string) => Promise<string>
  /** Reveal the last exported diagnostics bundle in the OS file manager. */
  showDiagnostics: () => Promise<void>
  /** Switch the active profile and relaunch. */
  switchProfile: (name: string) => Promise<void>
  /** Create a new Web profile. */
  createProfile: (name: string) => Promise<void>
  /** Fire-and-forget task runner funnelling rejections to the error reporter. */
  runTask: (task: Promise<unknown>) => void
}

export function createRecoveryService(deps: RecoveryDeps) {
  /** Forget the session-level failure hints once recovery has been left. */
  function clearSessionHints(): void {
    deps.recovery.failureMessage = undefined
    deps.recovery.failurePlugin = undefined
    deps.recovery.failurePlugins = []
  }

  /** Leave recovery if the profile is healthy enough to do so automatically. */
  async function maybeLeaveRecoveryMode(profileDir: string): Promise<boolean> {
    if (!await tryAutoLeaveRecoveryMode(profileDir)) return false
    clearSessionHints()
    return true
  }

  /** Bring the DSH view forward and, if possible, leave recovery mode. */
  async function returnToWorkbench(): Promise<void> {
    const running = deps.server()
    if (running === undefined) throw new Error('DSH 尚未成功启动，无法进入工作台。')
    const view = deps.dshView()
    const profileDir = deps.recovery.profileDir
    if (profileDir !== undefined) {
      await deps.advanceDiagnostic(profileDir, 'renderer-loading')
      deps.startRendererHealthTimer(profileDir)
    }
    deps.adoptServer(running)
    await deps.navigate(view, () => deps.loadURL(view.webContents, running.url))
    deps.showDshContentView()
    const window = deps.mainWindow()
    window?.maximize()
    window?.show()
    window?.focus()
    if (profileDir !== undefined) await maybeLeaveRecoveryMode(profileDir)
  }

  /** Open the workbench, or the recovery assistant when the profile needs it. */
  async function openWorkbenchOrRecovery(profileDir: string, serverUrl: string): Promise<void> {
    if (isRecoveryModeActive(profileDir)) {
      if (await maybeLeaveRecoveryMode(profileDir)) {
        await deps.createMainWindow(serverUrl)
        return
      }
      await showRecoveryWindow(profileDir)
      return
    }
    await deps.createMainWindow(serverUrl)
  }

  /** Open the recovery assistant, sized for reading a stack trace. */
  async function showRecoveryWindow(profileDir: string, failure?: { failureMessage: string, failurePlugins: string[] }): Promise<void> {
    deps.stopRendererHealthTimer()
    const window = deps.createWindow()
    // The recovery page drops the workbench's larger minimum size so it fits on small
    // screens; the DSH view restores it via showDshContentView().
    window.setMinimumSize(720, 520)
    if (window.isMaximized()) window.unmaximize()
    window.setSize(920, 680)
    window.center()
    const view = deps.recoveryView()
    deps.recovery.profileDir = profileDir
    if (failure !== undefined) {
      deps.recovery.failureMessage = failure.failureMessage
      deps.recovery.failurePlugins = failure.failurePlugins
      deps.recovery.failurePlugin = failure.failurePlugins[0]
    }
    deps.showRecoveryContentView()
    const html = deps.resolveRecoveryHtml()
    if (html === undefined) {
      // The built page comes from `build:recovery-ui`, which `build:all` runs. A
      // missing artifact means that step was skipped, so say so rather than reporting
      // a generic missing-resource error.
      throw new Error('恢复页面资源缺失，请先运行 pnpm run build:recovery-ui。')
    }
    const { colorScheme, locale } = deps.theme()
    // `requested` distinguishes "the user asked for recovery" from "startup failed";
    // the page renders a different reason card for each.
    const query = {
      theme: colorScheme,
      locale,
      requested: deps.recoveryRequested() ? '1' : '0',
      safeMode: deps.safeModeRequested() ? '1' : '0',
    }
    await deps.navigate(view, () => deps.loadFile(view.webContents, html, query))
  }

  /** Boot straight into the assistant, without starting the DSH host. */
  async function runRecoveryLaunch(mode: 'recovery' | 'safe-mode'): Promise<void> {
    const profileDir = deps.recovery.profileDir
    if (profileDir === undefined) throw new Error('恢复启动缺少 profile 目录。')
    try {
      await showRecoveryWindow(profileDir, {
        failureMessage: mode === 'recovery' ? '已按请求进入恢复模式。' : '已进入安全模式。',
        failurePlugins: [],
      })
    } catch (error) {
      // The assistant failing to open is itself a startup failure and the user has no
      // UI left to report it in, so make it loud and exit non-zero.
      console.error('无法打开恢复助手：', error instanceof Error ? error.stack ?? error.message : String(error))
      app.exit(1)
    }
  }

  /** Restart the DSH child in place, then land on the chosen destination. */
  async function restartDsh(profileDir: string, destination: 'recovery' | 'workbench' = 'recovery'): Promise<void> {
    deps.setRecycling(true)
    deps.broadcastShellState()
    try {
      const current = deps.releaseServer()
      await current?.stop()
      await deps.startDshChild(profileDir)
      deps.recovery.failureMessage = undefined
      if (destination === 'workbench') await returnToWorkbench()
      else await showRecoveryWindow(profileDir)
    } catch (error) {
      await deps.reportStartupFailure(error, profileDir)
      throw error
    } finally {
      deps.syncProfileWatcher()
      deps.setRecycling(false)
      deps.broadcastShellState()
    }
  }

  /** Build the checkpoint manager for the profile being recovered. */
  function checkpointFor(profileDir: string) {
    return createDesktopProfileCheckpoint({
      userDataDir: app.getPath('userData'),
      profileDir,
      homeDir: deps.homeDir(),
      profileName: profileNameOf(profileDir),
      appVersion: app.getVersion(),
    })
  }

  /**
   * The CURRENT profile's three slots.
   *
   * VERIFIED AGAINST dsh-desktop's real on-disk layout
   * (\\u0025APPDATA\\DSH Desktop\\health-snapshots): one directory per profile
   * (named by a hash of the profile directory), each holding slot-1..slot-3, with
   * every manifest recording its \`profileName\`. Its UI lists the ACTIVE profile's
   * three slots and labels them 槽位 1/2/3 with no profile on the card — the profile
   * is stated once, higher up the page.
   *
   * So slots are per-profile on disk (we already matched that), and the page shows
   * one profile's set at a time. Switching which profile you are recovering is the
   * "切换 Profile" tab's job, not something the rollback list mixes together.
   */
  function listCurrentProfileSlots(profileDir: string): readonly ProjectedCheckpointSlot[] {
    const name = profileNameOf(profileDir)
    return projectCheckpointSlots(checkpointFor(profileDir).listSlots(), name)
  }

  /** Profile directory name — the same key the slot layout is built from. */
  function profileNameOf(profileDir: string): string {
    return profileDir.split(/[\\/]/).filter(Boolean).pop() ?? 'unknown'
  }

  /** Rebuild a profile directory from its name (slots are keyed by name). */
  function profileDirForName(name: string): string {
    const current = deps.recovery.profileDir
    if (current === undefined) throw new Error('恢复页面尚未准备完成。')
    if (profileNameOf(current) === name) return current
    // Profiles are siblings under <DSH_HOME>/profiles, so swap the last segment.
    const parts = current.split(/([\\/])/)
    const last = parts.length - 1
    parts[last] = name
    return parts.join('')
  }

  /**
   * Parse \`<slotId>@<sourceProfile>\`.
   *
   * The combined token keeps the existing single-string IPC payload shape (the
   * preload and the two-phase confirmation both deal in one opaque target string)
   * while still naming the profile the slot came from.
   */
  function parseCheckpointRef(payload: string): { slotId: string, sourceProfile?: string } {
    const at = payload.lastIndexOf('@')
    if (at <= 0) return { slotId: payload }
    const sourceProfile = payload.slice(at + 1)
    return sourceProfile === ''
      ? { slotId: payload.slice(0, at) }
      : { slotId: payload.slice(0, at), sourceProfile }
  }

  /** Narrow an untrusted slot id to the fixed set. */
  function assertSlotId(value: string): DesktopProfileCheckpointSlotId {
    const candidate = DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS.find(id => id === value)
    if (candidate === undefined) throw new Error(`槽位标识不合法：${JSON.stringify(value)}`)
    return candidate
  }

  /** The status projection the recovery page renders from. */
  async function pageStatus(profileDir: string): Promise<Record<string, unknown>> {
    const status: RecoveryStatus = await getRecoveryStatus(profileDir)
    const suspectedPlugin = status.suspectedPlugin ?? deps.recovery.failurePlugin
    const failureMessage = deps.recovery.failureMessage ?? status.failureMessage
    return {
      ...status,
      running: deps.server() !== undefined,
      candidates: deps.recovery.failurePlugins.map(packageName => ({ packageName })),
      ...(failureMessage === undefined ? {} : { failureMessage }),
      ...(suspectedPlugin === undefined ? {} : { suspectedPlugin }),
    }
  }

  /** Data-directory state for the page. */
  function dataDirectoryView(): Record<string, unknown> {
    const location = deps.dataDirectory()
    return {
      currentDirectory: location.homeDir,
      usingDefaultDirectory: location.source === 'default',
      source: location.source,
      previousHome: location.previousHome,
    }
  }

  /**
   * Run one recovery action.
   *
   * A single dispatcher rather than one function per action: the page sends an action
   * NAME from a fixed set (`recovery-actions.ts`), so the surface the renderer can
   * reach is bounded by that list rather than by whatever happens to be exported.
   */
  async function perform(action: RecoveryActionId, payload?: string): Promise<unknown> {
    const profileDir = deps.recovery.profileDir
    if (profileDir === undefined) throw new Error('恢复页面尚未准备完成。')

    if (action === 'uninstall') {
      if (payload === undefined) throw new Error('缺少插件名。')
      const status = await uninstallRecoveryPlugin(profileDir, payload)
      if (deps.recovery.failurePlugin === payload) deps.recovery.failurePlugin = undefined
      return status
    }
    if (action === 'restore') {
      if (payload === undefined) throw new Error('缺少插件名。')
      await restoreRecoveryPlugin(profileDir, payload)
      await restartDsh(profileDir)
      return pageStatus(profileDir)
    }
    if (action === 'keep-isolated') return pageStatus(profileDir)
    if (action === 'activate') {
      const current = await getRecoveryStatus(profileDir)
      // `enterRecoveryMode` is imported lazily by the caller; the status call above
      // already reflects whatever isolation the profile carries.
      if (!current.active) throw new Error('恢复环境尚未准备完成。')
      await restartDsh(profileDir)
      return pageStatus(profileDir)
    }
    if (action === 'return-to-workbench') {
      await returnToWorkbench()
      return undefined
    }
    if (action === 'startup-log') return deps.trimStartupLog(await deps.readStartupLog(profileDir))
    if (action === 'list-checkpoints') return listCurrentProfileSlots(profileDir)
    if (action === 'inspect-checkpoint') {
      if (payload === undefined) throw new Error('缺少槽位标识。')
      return checkpointFor(profileDir).inspectSlot(assertSlotId(payload))
    }
    if (action === 'restore-checkpoint') {
      if (payload === undefined) throw new Error('缺少槽位信息。')
      // Payload is `<slotId>@<sourceProfile>`: a slot may come from ANOTHER profile,
      // so the write target (this profile) is not necessarily the slot's owner.
      const { slotId, sourceProfile } = parseCheckpointRef(payload)
      const source = sourceProfile === undefined ? checkpointFor(profileDir) : checkpointFor(profileDirForName(sourceProfile))
      const restored = source.restoreSlot(assertSlotId(slotId), {
        profileDir,
        homeDir: deps.homeDir(),
      })
      await restartDsh(profileDir)
      return { restored, status: pageStatus(profileDir) }
    }
    if (action === 'list-profiles') return deps.listProfiles()
    if (action === 'data-directory') return dataDirectoryView()
    if (action === 'select-data-directory') {
      deps.selectDataDirectory(payload ?? null)
      return dataDirectoryView()
    }
    if (action === 'factory-reset') {
      await deps.factoryReset(profileDir)
      return dataDirectoryView()
    }
    if (action === 'enter-safe-mode') {
      await deps.requestSafeModeRestart()
      return undefined
    }
    if (action === 'export-diagnostics') {
      return await deps.exportDiagnostics(profileDir)
    }
    if (action === 'show-diagnostics') {
      await deps.showDiagnostics()
      return undefined
    }
    if (action === 'switch-profile') {
      if (payload === undefined) throw new Error('缺少 profile 名。')
      await deps.switchProfile(payload)
      return pageStatus(profileDir)
    }
    if (action === 'create-profile') {
      if (payload === undefined) throw new Error('缺少 profile 名。')
      await deps.createProfile(payload)
      return undefined
    }
    if ((OPEN_TARGET_ACTIONS as readonly string[]).includes(action)) {
      await deps.openTarget(action as RecoveryOpenTarget, profileDir)
      return undefined
    }
    throw new Error(`未知的恢复操作：${action}`)
  }

  return {
    clearSessionHints,
    maybeLeaveRecoveryMode,
    returnToWorkbench,
    openWorkbenchOrRecovery,
    showRecoveryWindow,
    runRecoveryLaunch,
    restartDsh,
    pageStatus,
    dataDirectoryView,
    perform,
    checkpointFor,
    /** Write the diagnostics bundle; resolves the file name for the page. */
    performExportDiagnostics: (profileDir: string) => deps.exportDiagnostics(profileDir),
    performShowDiagnostics: () => deps.showDiagnostics(),
    isRecoveryModeActive,
    leaveRecoveryMode,
  }
}

export type RecoveryService = ReturnType<typeof createRecoveryService>

/** Re-exported so the composition root does not need a second import. */
export { DATA_DIRECTORY_ACTIONS, FACTORY_RESET_ACTIONS, OPEN_TARGET_ACTIONS }
export { DESKTOP_APP_NAME }
