import { app, BrowserWindow, Menu, Notification, Tray, WebContentsView, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, session, shell, type Input, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile, writeFile as writeTextFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { DESKTOP_APP_NAME, DESKTOP_APP_USER_MODEL_ID, DESKTOP_TOAST_ACTIVATOR_CLSID, resolveDesktopRuntimeDir, resolveDesktopUserDataDir } from './app/app-identity.js'
import { OFFICIAL_DSH_VERSION } from './runtime/bundled-plugins.js'
import { resolveAppIconPath, resolveCompactIconCrop, resolveNotificationIconPath, resolveRasterIconPath, resolveTaskBadgeIconPath, TRAY_ICON_SIZE } from './app/app-icon.js'
import { WINDOW_ICON_PIXEL_SIZES, isLoopbackFaviconRequest } from './app/window-icon.js'
import { quitDesktopApp, shouldHideInsteadOfClose } from './app/app-lifecycle.js'
import type { DshServer, StartDshOptions } from './bridge/dsh-process.js'
import { isExternalOpenUrl, isSameOrigin } from './infra/navigation.js'
import { resolveWebProfileDir } from './profiles/plugin-seed.js'
import { applyPendingProfileUpdates, resolvePnpmStoreDir, seedBundledPlugins } from './profiles/plugin-seed.js'
import {
  assertProfileName,
  createProfileDirectory,
  deleteProfileDirectory,
  isSafeProfileName,
  listProfiles,
  profileDirFor,
  readActiveProfile,
  resolveProfileRoots,
  writeActiveProfile,
} from './profiles/profiles.js'
import { parseUnresolvedBundleError, removeProfileBundle, startAfterPluginUpdates } from './profiles/profile-repair.js'
import { confirmRecoveryStartup, enterRecoveryMode, getRecoveryStatus, isRecoveryModeActive, leaveRecoveryMode, restoreRecoveryPlugin, tryAutoLeaveRecoveryMode, uninstallRecoveryPlugin } from './recovery/recovery-mode.js'
import { findRecoveryCandidates, trimStartupLogForRecovery } from './recovery/recovery-diagnostics.js'
import { advanceStartupDiagnostic, beginStartupDiagnostic, completeStartupDiagnostic, failStartupDiagnostic, parseRendererBootReport, readStartupDiagnostic, type StartupDiagnosticStage } from './recovery/startup-diagnostics.js'
import { captureProfileHealthCheckpoint, readProfileHealthCheckpoint, restoreProfileHealthCheckpoint } from './profiles/profile-health-checkpoint.js'
import { resolveBundledPluginStore, resolvePluginBinDir } from './runtime/plugin-toolchain.js'
import { resolveDshBootstrap, resolveDshRuntime, resolveNodeExecutable } from './runtime/runtime.js'
import { renderTerminalEntry } from './desktop/dsh-term.js'
import { createDesktopState, type DesktopState } from './desktop/desktop-state.js'
import { launchDsh, type DshLaunchResult } from './desktop/launch-service.js'
import { createWindowRegistry, type WindowRegistry } from './desktop/window-registry.js'
import { createNotificationService, type NotificationService } from './desktop/notification-service.js'
import { notificationPreferencesPath, updatePreferencesPath } from './desktop/preference-paths.js'
import { createUpdateService, type UpdateService } from './desktop/update-service.js'
import { createTrayService, type TrayService } from './desktop/tray-service.js'
import { createShellIpcRegistrar, type ShellIpcRegistrar } from './desktop/shell-ipc-registrar.js'
import { createTerminalService, type TerminalService } from './desktop/terminal-service.js'
import { createDialogService, type DesktopSettingsSection, type DialogService } from './desktop/dialog-service.js'
import { createProfileActionsService, type ProfileActionsService, type ProfileOperationView } from './desktop/profile-actions-service.js'
import { createShellBroadcastService, type ShellBroadcastService } from './desktop/shell-broadcast-service.js'
import { createRestartService, type RestartService } from './recovery/restart-service.js'
import { resolveLauncherProfileRoots } from './desktop/launcher-roots.js'
import { createDesktopProfileCheckpoint, DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS, type DesktopProfileCheckpointSlotId } from './recovery/profile-checkpoint.js'
import { projectCheckpointSlots } from './recovery/renderer-views.js'
import { dismissDshSettingsDialog as _ipcDismissDshSettingsDialog, sendDshAction as _ipcSendDshAction, shellRendererKind as _ipcShellRendererKind, isActionEnabled as _ipcIsActionEnabled } from './desktop/ipc-routes.js'
import { resolveLaunchDecision } from './recovery/launch-mode.js'
import { createRecoveryService, type RecoveryService } from './recovery/recovery-service.js'
import { isRecoveryAction, type RecoveryActionId } from './recovery/recovery-actions.js'
import { factoryResetDataDirectory } from './recovery/factory-reset.js'
import { openRecoveryTarget } from './recovery/open-targets.js'
import { selectDataDirectory } from './recovery/data-directory.js'
import { resolveLauncherDataDirectory } from './desktop/launcher-roots.js'
import { extractPackagedRuntimesInChild, packagedRuntimesNeedExtraction, type RuntimeExtractionProgress } from './runtime/extract-runtime.js'
import { resolvePrebuiltOfficialRuntime } from './runtime/runtime-prebuilt.js'
import { applyInitialWindowState } from './desktop/window-state.js'
import { WindowNavigationCoordinator } from './desktop/window-navigation.js'
import { escapeRoute } from './infra/escape-routing.js'
import { isDesktopActionMessage, isDesktopHostMessage, isDesktopProfileActionMessage, prepareDesktopBridge, resolveDesktopBridgeDir } from './bridge/desktop-host.js'
import { migrateDesktopBridgeProfile } from './bridge/desktop-bridge-migration.js'
import { prepareDesktopSettings, resolveDesktopSettingsDir } from './bridge/desktop-settings-plugin.js'
import { isChineseLocale, localizedShellActions, localizedShellMenus, normalizeShellLocale, shellActionForShortcut, SHELL_ACTIONS, type ShellActionId, type ShellMenuId } from './desktop/shell-actions.js'
import { SHELL_BAR_HEIGHT, SHELL_IPC, type DshNavigationState, type DshShellActionId, type ShellBootstrap, type ShellMenuPopupRequest, type ShellState, type ShellToolId, type ShellToolPopupId } from './desktop/shell-contract.js'
import { mayAccessDesktopUpdates, mayAccessNotificationPreferences, mayCloseDesktopSettings, mayGetShellBootstrap, mayInvokeShellAction, mayPopupShellMenu, mayReportDshBoot, mayReportDshLocale, mayReportDshNotification, mayReportDshState, mayReportDshTheme, mayReportDshSettingsVisibility, type ShellRendererKind } from './desktop/shell-ipc-policy.js'
import { DESKTOP_THEME_PALETTES, normalizeDesktopThemeSnapshot, type DesktopColorScheme, type DesktopThemePreference } from './desktop/desktop-theme.js'
import { DSH_MARKET_STATUS_PATH, waitForDshMarketBatchToSettle } from './desktop/dshmarket-batch.js'
import { buildWindowsReplyToastXml, loadNotificationPreferences, parseDesktopNotificationBridgeEvent, parseWindowsNotificationReplyActivation, saveNotificationPreferences, shouldShowDesktopNotification, windowsNotificationReplyArguments, type DesktopNotificationEvent, type DesktopNotificationPreferences } from './desktop/desktop-notifications.js'
import { watchProfileActivation } from './profiles/profile-watch.js'
import updater from 'electron-updater'
import { STARTUP_UPDATE_CHECK_DELAY_MS, buildDesktopTrayItems, desktopUpdateChannel, desktopUpdatePrompt, formatDesktopReleaseNotes, loadUpdatePreferences, publicDesktopUpdateError, saveUpdatePreferences, shouldCheckForUpdatesOnStartup, shouldDownloadUpdateAutomatically, type DesktopUpdateAction, type DesktopUpdatePreferences, type DesktopUpdateSnapshot, type DesktopUpdateStatus } from './desktop/desktop-updater.js'

interface DshProcessModule {
  isApplyPluginUpdatesIpc: (message: unknown) => boolean
  startDsh: (options: StartDshOptions) => Promise<DshServer>
}

const dshProcessModule = await import(app.isPackaged
  ? pathToFileURL(join(process.resourcesPath, 'desktop-bridge', 'dsh-process.js')).href
  : './bridge/dsh-process.js') as DshProcessModule
const { isApplyPluginUpdatesIpc, startDsh } = dshProcessModule

const { autoUpdater } = updater
const windowNavigation = new WindowNavigationCoordinator()
const shellActionIds = new Set<string>(SHELL_ACTIONS.map(action => action.id))

/**
 * Explicit mutable state. Assigned in `startApplication()` after preferences load
 * and before IPC registration — see `desktop/desktop-state.ts` for why the fields
 * must stay mutable rather than becoming a snapshot.
 */
let state: DesktopState

function startupErrorLogPath(profileDir?: string): string {
  return profileDir === undefined
    ? join(app.getPath('userData'), 'startup-error.log')
    : join(profileDir, '.dsh-desktop-startup-error.log')
}

function desktopLocale(): string {
  return state.shell.locale ?? app.getLocale()
}

function desktopText(zh: string, en: string): string {
  return isChineseLocale(desktopLocale()) ? zh : en
}

process.on('uncaughtException', handleUnexpectedMainError)
process.on('unhandledRejection', handleUnexpectedMainError)

app.setName(DESKTOP_APP_NAME)
app.setAppUserModelId(DESKTOP_APP_USER_MODEL_ID)
if (process.platform === 'win32') app.setToastActivatorCLSID(DESKTOP_TOAST_ACTIVATOR_CLSID)
if (!process.argv.some(argument => argument.startsWith('--user-data-dir='))) {
  app.setPath('userData', resolveDesktopUserDataDir(app.getPath('appData')))
}
protocol.registerSchemesAsPrivileged([
  { scheme: 'dsh-icon', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  app.on('activate', () => showMainWindow())
  app.on('before-quit', event => {
    if (state.runtime.isQuitting) return
    event.preventDefault()
    runMainTask(requestQuit())
  })

  runMainTask(startApplication())
}

async function requestQuit(): Promise<void> {
  await shutdownDesktop(() => app.exit())
}

async function shutdownDesktop(exit: () => void): Promise<void> {
  await quitDesktopApp({
    isQuitting: state.runtime.isQuitting,
    markQuitting: () => { state.runtime.isQuitting = true },
    destroyTray: () => {
      if (state.update.startupUpdateTimer !== undefined) clearTimeout(state.update.startupUpdateTimer)
      state.update.startupUpdateTimer = undefined
      state.runtime.tray?.destroy()
      state.runtime.tray = undefined
      state.launch.profileWatcher?.stop()
      state.launch.profileWatcher = undefined
    },
    stopServer: async () => {
      const extraction = state.runtime.runtimeExtractionTask
      state.runtime.runtimeExtractionAbortController?.abort()
      await extraction?.catch(() => undefined)
      const current = state.runtime.server
      state.runtime.server = undefined
      await current?.stop()
    },
    exit,
  })
}


/**
 * Resolve every piece of launch state the DSH child needs, WITHOUT starting it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The recovery page can restart DSH ("restart DSH in recovery mode" and "roll back
 * to this snapshot" both land in restartDsh), and restartDsh requires
 * lastStartOptions/lastSeedOptions. Those were only ever assigned on the NORMAL
 * launch path — a user who entered recovery directly (--dsh-desktop-recovery) never
 * ran that path, so recovery-mode restarts threw "Startup parameters not yet ready".
 *
 * This is the normal path's preparation sequence, extracted verbatim: path/runtime
 * resolution, bridge + settings-plugin materialization, seed options, start options.
 * Both callers assign the results to state.launch so restartDsh sees a complete set.
 */
async function prepareLaunchOptions(profileDir: string, activeProfileName: string): Promise<void> {
  const runtimeOptions = {
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  }
  const pathPrefix = resolvePluginBinDir(runtimeOptions)
  const pnpmEntry = pathPrefix === undefined ? process.env.npm_execpath : join(pathPrefix, 'pnpm-package', 'bin', 'pnpm.cjs')
  const desktopRuntimeDir = resolveDesktopRuntimeDir(app.getPath('userData'), {
    isPackaged: app.isPackaged,
    execPath: process.execPath,
  })
  const extractedStoreDir = app.isPackaged ? join(dirname(desktopRuntimeDir), 'plugins', 'store') : undefined
  const nodeExecutable = resolveNodeExecutable(runtimeOptions)
  const desktopBridgePatch = prepareDesktopBridge(join(app.getPath('userData'), 'desktop-bridge'), resolveDesktopBridgeDir(runtimeOptions))
  migrateDesktopBridgeProfile(profileDir)
  const desktopSettingsPatch = prepareDesktopSettings(
    join(app.getPath('userData'), 'desktop-settings-plugin'),
    resolveDesktopSettingsDir({ ...runtimeOptions, pluginDevDir: process.env.DSH_DESKTOP_SETTINGS_DIR }),
    app.getVersion(),
  )
  const pluginStoreDir = resolveBundledPluginStore({
    ...runtimeOptions,
    ...(extractedStoreDir === undefined ? {} : { extractedStoreDir }),
  })
  const profileStoreDir = resolvePnpmStoreDir(profileDir, pluginStoreDir)
  const prebuiltRuntimeDir = resolvePrebuiltOfficialRuntime(runtimeOptions)
  const seedOptions = {
    nodeExecutable,
    ...(pnpmEntry === undefined ? {} : { pnpmEntry }),
    profileDir,
    desktopRuntimeDir,
    pluginStoreDir: pluginStoreDir ?? '',
    ...(prebuiltRuntimeDir === undefined ? {} : { prebuiltRuntimeDir }),
    ...(pathPrefix === undefined ? {} : { pathPrefix }),
  }
  const runtime = resolveDshRuntime({ ...runtimeOptions, profileDir, desktopRuntimeDir })
  const startOptions = {
    bootstrapPath: resolveDshBootstrap(runtimeOptions),
    // Boot the persisted active profile explicitly (--profile <name>); the bare
    // web subcommand is hardcoded to --profile web and would ignore it.
    profileName: activeProfileName,
    patches: desktopSettingsPatch === undefined
      ? [desktopBridgePatch]
      : [desktopBridgePatch, desktopSettingsPatch],
    ...(pathPrefix === undefined ? {} : { pathPrefix }),
    runtime,
    nodeExecutable,
    environment: {
      DSH_HOME: resolve(profileDir, '..', '..'),
      DSH_PROFILE_DIR: profileDir,
      DSH_PROFILE_NAME: activeProfileName,
      DSH_PROFILE_SELECTION_DIR: app.getPath('userData'),
      DSH_RUNTIME_DIR: desktopRuntimeDir,
      ...(pnpmEntry === undefined ? {} : { DSH_PNPM_ENTRY: pnpmEntry }),
      ...(profileStoreDir === undefined ? {} : { DSH_PNPM_STORE_DIR: profileStoreDir }),
    },
  }
  state.launch.lastSeedOptions = seedOptions
  state.launch.lastStartOptions = startOptions
}

async function startApplication(): Promise<void> {
  await app.whenReady()
  // Load preferences BEFORE creating the store and registering IPC: the shell
  // handlers read these values at call time and would otherwise see defaults.
  const notificationPreferences = await loadNotificationPreferences(notificationPreferencesPath())
  const updatePreferences = await loadUpdatePreferences(updatePreferencesPath())
  state = createDesktopState({
    notificationPreferences,
    updatePreferences,
    initialColorScheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  })
  // Bind the window registry to the app's real collaborators once. It must exist
  // before any window is created, but AFTER the store (it reads handles from it).
  windowRegistry = createWindowRegistry({
    state,
    resolvePreload,
    resolveShellAsset,
    resolveWindowIconImage,
    isNavigating: () => windowNavigation.isNavigating(),
    installShortcutHandler,
    runTask: runMainTask,
    broadcastShellState,
  })
  // The three services below form the cycle documented in ticket 06. Their edges
  // are wired HERE, in one place, so no module imports another in a loop:
  //   updater → tray   (status change refreshes the menu)
  //   tray    → updater (menu items drive check/download/install)
  //   notifications → tray (unread badge refreshes the menu)
  notificationService = createNotificationService({
    windows: state.windows,
    notifications: state.notifications,
    locale: desktopLocale,
    refreshTrayMenu,
    showMainWindow,
    showDesktopSettingsWindow,
    runTask: runMainTask,
  })
  updateService = createUpdateService({
    update: state.update,
    notifications: state.notifications,
    locale: desktopLocale,
    text: desktopText,
    isQuitting: () => state.runtime.isQuitting,
    refreshTrayMenu,
    broadcastUpdateState: broadcastDesktopUpdateState,
    showDesktopSettingsWindow,
    shutdown: shutdownDesktop,
    runTask: runMainTask,
  })
  trayService = createTrayService({
    tray: {
      get current() { return state.runtime.tray },
      set current(value) { state.runtime.tray = value },
    },
    update: state.update,
    notifications: state.notifications,
    locale: desktopLocale,
    showMainWindow,
    reloadDsh: recycleDshForPluginUpdate,
    requestQuit,
    checkForUpdates: async () => { await checkDesktopUpdate() },
    downloadUpdate: async () => { await downloadDesktopUpdate() },
    installUpdate: installDesktopUpdate,
    runTask: runMainTask,
  })
  // Windows toast identity and the activation handler both go through the
  // notification service, so they must run AFTER the services above are created.
  ensureWindowsNotificationIdentity()
  installWindowsNotificationActivationHandler()
  // The shell IPC registrar needs every service above (it dispatches into them),
  // so it is created last of the group — before any channel is registered.
  shellIpcRegistrar = createShellIpcRegistrar({
    state,
    rendererKind: shellRendererKind,
    bootstrap: shellBootstrap,
    broadcastShellState,
    broadcastShellBootstrap,
    executeShellAction,
    runShellTool,
    popupShellTool,
    popupShellMenu,
    saveNotificationPreferences: value => saveNotificationPreferences(notificationPreferencesPath(), value),
    saveUpdatePreferences: value => saveUpdatePreferences(updatePreferencesPath(), value),
    updateSnapshot: desktopUpdateSnapshot,
    handleUpdateAction: handleDesktopUpdateSettingsAction,
    applyTheme: applyDesktopTheme,
    reportRendererBoot: handleRendererBootReport,
    updateUnreadBadge: updateUnreadCompletionBadge,
    handleBridgeNotification: handleBridgeNotificationEvent,
    runTask: runMainTask,
  })
  // Narrow interface in practice: the terminal receives ONLY the launch state it
  // reads. Note there is no `state` here — the signature shows at a glance that
  // opening a terminal touches no window, update, notification or recovery state.
  terminalService = createTerminalService({
    lastSeedOptions: () => state.launch.lastSeedOptions,
    locale: desktopLocale,
    profileRoots: launcherProfileRoots,
  })
  // Dialog handles live on the store; the service mutates them through accessors so
  // it never captures a window value at construction time.
  dialogService = createDialogService({
    mainWindow: () => state.windows.mainWindow,
    settingsWindow: {
      get: () => state.windows.settingsWindow,
      set: window => { state.windows.settingsWindow = window },
    },
    shortcutsWindow: {
      get: () => state.windows.shortcutsWindow,
      set: window => { state.windows.shortcutsWindow = window },
    },
    aboutWindow: {
      get: () => state.windows.aboutWindow,
      set: window => { state.windows.aboutWindow = window },
    },
    colorScheme: () => state.shell.colorScheme,
    text: desktopText,
    resolveShellAsset,
    resolvePreload,
    resolveWindowIconImage,
    installShortcutHandler,
    updateSnapshot: desktopUpdateSnapshot,
    runTask: runMainTask,
  })
  // Restart orchestration lives in its own module and imports nothing from
  // electron, so it stays testable; the real app hooks are supplied here.
  restartService = createRestartService({
    locale: desktopLocale,
    relaunch: args => { if (args === undefined) app.relaunch(); else app.relaunch({ args }) },
    exit: code => app.exit(code),
    shutdown: shutdownDesktop,
    argv: () => process.argv,
    // Widen to Electron's own option type; the narrow one exists only so the
    // restart module stays free of an `electron` import.
    confirm: async options => dialog.showMessageBox({ ...options, buttons: [...options.buttons] }),
  })
  // Profile ops read launch state at call time; the recovery restart is delegated
  // to the restart service so it relaunches the whole app rather than the child.
  profileActions = createProfileActionsService({
    lastSeedOptions: () => state.launch.lastSeedOptions,
    isQuitting: () => state.runtime.isQuitting,
    dshView: () => state.windows.dshView,
    shutdown: shutdownDesktop,
    requestRecoveryRestart: () => requireRestartService().requestRecoveryRestart(),
  })
  // The recovery flow. Its outward edges — launching DSH, navigating a view, the
  // window registry — are injected here, which is what keeps recovery and the startup
  // orchestration from importing each other in a loop.
  recovery = createRecoveryService({
    recovery: state.recovery,
    server: () => state.runtime.server,
    mainWindow: () => state.windows.mainWindow,
    createWindow,
    recoveryView: requireRecoveryView,
    dshView: requireDshView,
    showDshContentView,
    showRecoveryContentView,
    navigate: (view, load) => windowNavigation.navigate(view, load),
    loadFile: (contents, filePath, query) => contents.loadFile(filePath, { query }),
    loadURL: (contents, url) => contents.loadURL(url),
    resolveRecoveryHtml: resolveRecoveryUiHtml,
    theme: () => ({ colorScheme: state.shell.colorScheme, locale: desktopLocale() }),
    recoveryRequested: () => state.launch.recoveryRequested,
    createMainWindow,
    broadcastShellState,
    setRecycling: value => { state.runtime.isRecycling = value },
    startDshChild: async profileDir => {
      await launchDsh({
        startDsh,
        startOptions: () => state.launch.lastStartOptions,
        desktopRuntimeDir: () => state.launch.lastSeedOptions?.desktopRuntimeDir,
        // The origin guard must be updated before the diagnostic advances, matching
        // the original ordering at this call site.
        setServer: server => {
          state.runtime.server = server
          state.shell.allowedOrigin = new URL(server.url).origin
        },
        beginDiagnostic: beginDshStartupDiagnostic,
        advanceDiagnostic: advanceDshStartupDiagnostic,
        onUnexpectedExit: handleUnexpectedDshExit,
        onIpcMessage: handleDshIpc,
      }, profileDir)
    },
    adoptServer: server => { state.shell.allowedOrigin = new URL(server.url).origin },
    releaseServer: () => {
      const current = state.runtime.server
      state.runtime.server = undefined
      return current
    },
    advanceDiagnostic: async (profileDir, stage) => { await advanceDshStartupDiagnostic(profileDir, stage) },
    startRendererHealthTimer,
    stopRendererHealthTimer,
    reportStartupFailure: async (error, profileDir) => { await reportStartupFailure(error, profileDir) },
    syncProfileWatcher: () => { state.launch.profileWatcher?.sync() },
    homeDir: () => resolveLauncherProfileRoots(app.getPath('userData')).home,
    listProfiles: () => desktopProfileViews(),
    openTarget: async (target, profileDir) => {
      const roots = resolveLauncherProfileRoots(app.getPath('userData'))
      await openRecoveryTarget(target, { homeDir: roots.home, profileDir }, path => shell.openPath(path))
    },
    readStartupLog: async profileDir => await readFile(startupErrorLogPath(profileDir), 'utf8').catch(() => ''),
    trimStartupLog: trimStartupLogForRecovery,
    openPath: async path => shell.openPath(path),
    factoryReset: async profileDir => {
      await factoryResetDataDirectory({
        homeDir: resolveLauncherProfileRoots(app.getPath('userData')).home,
        userDataDir: app.getPath('userData'),
        protectedPaths: [profileDir],
        trashItem: async path => { await shell.trashItem(path) },
        recreate: false,
      })
    },
    dataDirectory: () => resolveLauncherDataDirectory(app.getPath('userData')),
    selectDataDirectory: target => {
      selectDataDirectory(app.getPath('userData'), target, {
        defaultHome: join(homedir(), '.dsh'),
      })
    },
    runTask: runMainTask,
  })
  // Broadcast/theme is the cross-cutting concern; created before the IPC registrar
  // (which dispatches theme reports into it) and before the dialog service.
  shellBroadcast = createShellBroadcastService({
    windows: state.windows,
    shell: state.shell,
    isRecycling: () => state.runtime.isRecycling,
    locale: desktopLocale,
    appVersion: () => app.getVersion(),
    updateSnapshot: desktopUpdateSnapshot,
  })
  installShellIpc()
  installRecoveryIpc()
  installDesktopFaviconReplacement()
  Menu.setApplicationMenu(null)
  configureDesktopUpdater()
  createTray()
  await showStartupWindow(desktopText('正在启动', 'Starting'))

  // RECOVERY GATE — resolved from the one-shot markers on the command line, BEFORE
  // anything is started. In recovery the app must be usable when the DSH host
  // cannot boot at all, so the host is never launched and we return from here.
  const launch = resolveLaunchDecision(process.argv)
  if (!launch.startsHost) {
    // Record WHY we are here: the page's reason card differs between "the user asked
    // for recovery" and "startup failed", and only the launcher knows which.
    state.launch.recoveryRequested = true
        const recoveryRoots = resolveLauncherProfileRoots(app.getPath('userData'))
        const recoveryProfileName = readActiveProfile(recoveryRoots)
        const recoveryProfileDir = profileDirFor(recoveryRoots.home, recoveryProfileName)
        state.recovery.profileDir = recoveryProfileDir
        // Prepare the launch state WITHOUT starting DSH: recovery-mode restarts and
        // checkpoint rollbacks go through restartDsh, which reads lastStartOptions and
        // lastSeedOptions. Skipping this left those undefined on direct recovery entry.
        await prepareLaunchOptions(recoveryProfileDir, recoveryProfileName)
        await runRecoveryLaunch(launch.mode === 'safe-mode' ? 'safe-mode' : 'recovery')
    return
  }

  try {
    const runtimeOptions = {
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }
    const pathPrefix = resolvePluginBinDir(runtimeOptions)
    const pnpmEntry = pathPrefix === undefined ? process.env.npm_execpath : join(pathPrefix, 'pnpm-package', 'bin', 'pnpm.cjs')
    // Launch the persisted active profile (defaults to the legacy "web").
    const profileRoots = resolveLauncherProfileRoots(app.getPath('userData'))
    const activeProfileName = readActiveProfile(profileRoots)
    const profileDir = profileDirFor(profileRoots.home, activeProfileName)
    const desktopRuntimeDir = resolveDesktopRuntimeDir(app.getPath('userData'), {
      isPackaged: app.isPackaged,
      execPath: process.execPath,
    })
    const extractedStoreDir = app.isPackaged ? join(dirname(desktopRuntimeDir), 'plugins', 'store') : undefined
    const nodeExecutable = resolveNodeExecutable(runtimeOptions)
    if (app.isPackaged) {
      const firstInitialization = packagedRuntimesNeedExtraction(process.resourcesPath, desktopRuntimeDir, extractedStoreDir!)
      if (firstInitialization) {
        await updateStartupMessage(firstInitializationMessage())
        const controller = new AbortController()
        state.runtime.runtimeExtractionAbortController = controller
        const extraction = extractPackagedRuntimesInChild({
          nodeExecutable,
          scriptPath: join(process.resourcesPath, 'extract-runtime.mjs'),
          installDir: dirname(desktopRuntimeDir),
          resourcesDir: process.resourcesPath,
          signal: controller.signal,
          onProgress: progress => { void updateStartupMessage(runtimeExtractionMessage(progress)) },
        })
        state.runtime.runtimeExtractionTask = extraction
        try {
          await extraction
        } finally {
          if (state.runtime.runtimeExtractionTask === extraction) state.runtime.runtimeExtractionTask = undefined
          if (state.runtime.runtimeExtractionAbortController === controller) state.runtime.runtimeExtractionAbortController = undefined
        }
        await updateStartupMessage(desktopText(
          '正在初始化插件和工作区…\n首次启动可能需要 1–3 分钟，请勿关闭应用。',
          'Initializing plugins and workspace…\nThe first launch may take 1–3 minutes. Please keep the app open.',
        ))
      }
    }
    const desktopBridgePatch = prepareDesktopBridge(join(app.getPath('userData'), 'desktop-bridge'), resolveDesktopBridgeDir(runtimeOptions))
    migrateDesktopBridgeProfile(profileDir)
    // Bundled private desktop-settings plugin (host+client), injected as a
    // `--patch` overlay just like the desktop bridge. Dev override via env
    // DSH_DESKTOP_SETTINGS_DIR; packaged reads the shipped extraResource.
    const desktopSettingsPatch = prepareDesktopSettings(
      join(app.getPath('userData'), 'desktop-settings-plugin'),
      resolveDesktopSettingsDir({ ...runtimeOptions, pluginDevDir: process.env.DSH_DESKTOP_SETTINGS_DIR }),
      app.getVersion(),
    )
    const pluginStoreDir = resolveBundledPluginStore({
      ...runtimeOptions,
      ...(extractedStoreDir === undefined ? {} : { extractedStoreDir }),
    })
    const profileStoreDir = resolvePnpmStoreDir(profileDir, pluginStoreDir)
    const prebuiltRuntimeDir = resolvePrebuiltOfficialRuntime(runtimeOptions)
    const seedOptions = {
      nodeExecutable,
      ...(pnpmEntry === undefined ? {} : { pnpmEntry }),
      profileDir,
      desktopRuntimeDir,
      pluginStoreDir: pluginStoreDir ?? '',
      ...(prebuiltRuntimeDir === undefined ? {} : { prebuiltRuntimeDir }),
      ...(pathPrefix === undefined ? {} : { pathPrefix }),
    }
    try {
      const seeded = await seedBundledPlugins(seedOptions)
      if (seeded.seeded.length > 0) console.log(`已补种官方运行时和社区插件：${seeded.seeded.join('、')}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '内置插件补种失败。'
      await writeTextFile(join(app.getPath('userData'), 'plugin-seed.log'), `${message}\n`, 'utf8').catch(() => undefined)
    }
    try {
      const updated = await applyPendingProfileUpdates(seedOptions)
      if (updated.length > 0) console.log('已在启动前应用插件更新：' + updated.join('、'))
    } catch (error) {
      const message = error instanceof Error ? error.message : '启动前应用插件更新失败。'
      await writeTextFile(join(app.getPath('userData'), 'plugin-update.log'), ` ${message}\n`, 'utf8').catch(() => undefined)

    }
    state.launch.lastSeedOptions = seedOptions
    const runtime = resolveDshRuntime({ ...runtimeOptions, profileDir, desktopRuntimeDir })
    const startOptions = {
      bootstrapPath: resolveDshBootstrap(runtimeOptions),
      // Boot the persisted active profile explicitly (`--profile <name>`); the
      // bare `web` subcommand is hardcoded to `--profile web` and would ignore it.
      profileName: activeProfileName,
      patches: desktopSettingsPatch === undefined
        ? [desktopBridgePatch]
        : [desktopBridgePatch, desktopSettingsPatch],
      ...(pathPrefix === undefined ? {} : { pathPrefix }),
      runtime,
      nodeExecutable,
      environment: {
        DSH_HOME: resolve(profileDir, '..', '..'),
        DSH_PROFILE_DIR: profileDir,
        DSH_PROFILE_NAME: activeProfileName,
        DSH_PROFILE_SELECTION_DIR: app.getPath('userData'),
        DSH_RUNTIME_DIR: desktopRuntimeDir,
        ...(pnpmEntry === undefined ? {} : { DSH_PNPM_ENTRY: pnpmEntry }),
        ...(profileStoreDir === undefined ? {} : { DSH_PNPM_STORE_DIR: profileStoreDir }),
      },
    }
    state.launch.lastStartOptions = startOptions
    let started: DshLaunchResult
    try {
      started = await launchDsh({
        startDsh,
        startOptions: () => state.launch.lastStartOptions,
        desktopRuntimeDir: () => desktopRuntimeDir,
        setServer: server => { state.runtime.server = server },
        beginDiagnostic: beginDshStartupDiagnostic,
        advanceDiagnostic: advanceDshStartupDiagnostic,
        onUnexpectedExit: handleUnexpectedDshExit,
        onIpcMessage: handleDshIpc,
      }, profileDir)
    } catch (error) {
      if (!state.runtime.isQuitting) await reportStartupFailure(error, profileDir)
      return
    }
    if (started.repaired.length > 0) console.log('已自我修复损坏的插件清单：' + started.repaired.join('、'))
    state.launch.profileWatcher?.stop()
    state.launch.profileWatcher = watchProfileActivation(profileDir, scheduleProfileActivationRecycle, { onError: handleUnexpectedMainError })
    await openWorkbenchOrRecovery(profileDir, started.server.url)
    const smokeReadyFile = process.env.DSH_DESKTOP_SMOKE_READY_FILE
    if (smokeReadyFile !== undefined && smokeReadyFile !== '') {
      await writeTextFile(smokeReadyFile, 'ready\n', 'utf8')
    }
    scheduleStartupUpdateCheck()
  } catch (error) {
    if (!state.runtime.isQuitting) await reportStartupFailure(error)
  }
}

function resolveStartupHtml(): string | undefined {
  const packaged = join(process.resourcesPath, 'startup.html')
  const dev = join(app.getAppPath(), 'assets', 'startup.html')
  if (existsSync(packaged)) return packaged
  if (existsSync(dev)) return dev
  return undefined
}

/**
 * The Vite-built recovery page.
 *
 * It is a DIRECTORY (HTML + hashed JS/CSS) produced by `vite build`, not a single
 * HTML file — which is why it resolves differently from the other shell assets.
 *
 * Both paths are checked in the packaged-first order the other resolvers use. The dev
 * path points at the BUILD OUTPUT rather than the source, because the sources are TSX
 * and only the built bundle is loadable; that is why `build:all` includes
 * `build:recovery-ui`.
 */
function resolveRecoveryUiHtml(): string | undefined {
  const packaged = join(process.resourcesPath, 'recovery-ui', 'index.html')
  const development = join(app.getAppPath(), 'dist', 'recovery-ui', 'index.html')
  if (existsSync(packaged)) return packaged
  if (existsSync(development)) return development
  return undefined
}


function resolveWindowIconFilePath(): string | undefined {
  return resolveRasterIconPath({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  }) ?? resolveWindowIconPath()
}

function resolveWindowIconImage(): Electron.NativeImage | undefined {
  if (state.chrome.cachedWindowIcon !== undefined && !state.chrome.cachedWindowIcon.isEmpty()) return state.chrome.cachedWindowIcon
  const iconPath = resolveWindowIconFilePath()
  if (iconPath === undefined) return undefined
  const source = nativeImage.createFromPath(iconPath)
  if (source.isEmpty()) return undefined
  const compactSource = source.crop(resolveCompactIconCrop(source.getSize()))
  const icon = nativeImage.createEmpty()
  for (const size of WINDOW_ICON_PIXEL_SIZES) {
    const resized = compactSource.resize({ width: size, height: size, quality: 'best' })
    icon.addRepresentation({
      width: size,
      height: size,
      buffer: resized.toPNG(),
      scaleFactor: 1,
    })
  }
  state.chrome.cachedWindowIcon = icon.isEmpty() ? source : icon
  return state.chrome.cachedWindowIcon
}

function installDesktopFaviconReplacement(): void {
  const iconPath = resolveWindowIconFilePath()
  if (iconPath === undefined) return
  const iconUrl = pathToFileURL(iconPath).href
  protocol.handle('dsh-icon', () => net.fetch(iconUrl))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (!isLoopbackFaviconRequest(details.url)) {
      callback({})
      return
    }
    callback({ redirectURL: 'dsh-icon://app/favicon.ico' })
  })
}

/**
 * Boot straight into the recovery assistant, without starting the DSH host.
 *
 * WHY THE HOST IS SKIPPED
 * -----------------------
 * Recovery exists for the case where the host cannot start — a plugin or profile
 * configuration that breaks DSH itself. Launching it anyway would either hang on the
 * same fault or take minutes to fail, so the assistant opens immediately and the
 * recovery IPC (which does not depend on the host) supplies its data.
 *
 * The profile directory is resolved the ordinary way: the user is repairing the
 * profile that was ACTIVE, and that is still recorded in the registry even when the
 * profile itself is broken.
 */
async function runRecoveryLaunch(mode: 'recovery' | 'safe-mode'): Promise<void> {
  await requireRecovery().runRecoveryLaunch(mode)
}

async function showStartupWindow(message: string): Promise<void> {
  const window = createWindow()
  const view = requireDshView()
  showDshContentView()
  const html = resolveStartupHtml()
  if (html !== undefined) {
    await windowNavigation.navigate(
      view,
      () => view.webContents.loadFile(html, { query: { theme: state.shell.colorScheme } }),
      () => view.webContents.executeJavaScript('document.getElementById("msg").textContent = ' + JSON.stringify(message)),
    )
    return
  }
  const escaped = message.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
  await windowNavigation.navigate(
    view,
    () => view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<main style="font-family:sans-serif;padding:48px"><h1>' + DESKTOP_APP_NAME + '</h1><p>' + escaped + '</p></main>')),
  )
}

async function updateStartupMessage(message: string): Promise<void> {
  const view = requireDshView()
  if (view.webContents.isDestroyed()) return
  await view.webContents.executeJavaScript(`document.getElementById('msg')?.replaceChildren(document.createTextNode(${JSON.stringify(message)}))`)
    .catch(() => undefined)
}

function firstInitializationMessage(): string {
  return desktopText(
    '首次启动，正在准备运行环境…\n可能需要 1–3 分钟，请勿关闭应用。',
    'Preparing the runtime for the first launch…\nThis may take 1–3 minutes. Please keep the app open.',
  )
}

function runtimeExtractionMessage(progress: RuntimeExtractionProgress): string {
  const hint = desktopText('\n首次启动可能需要 1–3 分钟，请勿关闭应用。', '\nThe first launch may take 1–3 minutes. Please keep the app open.')
  if (progress.phase === 'runtime') {
    return desktopText('正在校验并解压 DSH 运行环境…', 'Verifying and extracting the DSH runtime…') + hint
  }
  return desktopText('正在准备内置插件仓库…', 'Preparing the bundled plugin store…') + hint
}


async function createMainWindow(serverUrl: string): Promise<void> {
  state.shell.allowedOrigin = new URL(serverUrl).origin
  createWindow()
  const view = requireDshView()
  const profileDir = state.launch.lastSeedOptions?.profileDir
  if (profileDir !== undefined) {
    await advanceDshStartupDiagnostic(profileDir, 'renderer-loading')
    startRendererHealthTimer(profileDir)
  }
  showDshContentView()
  await windowNavigation.navigate(view, () => view.webContents.loadURL(serverUrl))
}

function startupDiagnosticPath(profileDir: string): string {
  return join(profileDir, '.dsh-desktop-startup-diagnostics.json')
}

async function beginDshStartupDiagnostic(profileDir: string): Promise<void> {
  state.diagnostics.stage = 'server-starting'
  await beginStartupDiagnostic(startupDiagnosticPath(profileDir), state.diagnostics.stage, {
    mode: isRecoveryModeActive(profileDir) ? 'recovery' : 'normal',
  }).catch(error => {
    console.error('无法记录 DSH 启动诊断。', error)
  })
}

async function advanceDshStartupDiagnostic(profileDir: string, stage: Exclude<StartupDiagnosticStage, 'healthy'>): Promise<void> {
  state.diagnostics.stage = stage
  await advanceStartupDiagnostic(startupDiagnosticPath(profileDir), stage).catch(error => {
    console.error('无法更新 DSH 启动诊断。', error)
  })
}

function stopRendererHealthTimer(): void {
  if (state.diagnostics.rendererHealthTimer !== undefined) clearTimeout(state.diagnostics.rendererHealthTimer)
  state.diagnostics.rendererHealthTimer = undefined
}

function startRendererHealthTimer(profileDir: string): void {
  stopRendererHealthTimer()
  state.diagnostics.rendererHealthTimer = setTimeout(() => {
    state.diagnostics.rendererHealthTimer = undefined
    void handleRendererBootReport({ status: 'failed', plugins: [], error: 'DSH 页面未能在 30 秒内完成插件加载。' }, profileDir, 'renderer-timeout')
  }, 30_000)
  state.diagnostics.rendererHealthTimer.unref()
}

async function handleRendererBootReport(value: unknown, profileDir = state.launch.lastSeedOptions?.profileDir, source: 'renderer' | 'renderer-timeout' = 'renderer'): Promise<void> {
  const report = parseRendererBootReport(value)
  if (report === undefined || profileDir === undefined) return
  stopRendererHealthTimer()
  if (report.status === 'healthy') {
    await completeStartupDiagnostic(startupDiagnosticPath(profileDir)).catch(error => {
      console.error('无法保存 DSH 健康启动证据。', error)
    })
    await confirmRecoveryStartup(profileDir)
    if (await maybeLeaveRecoveryMode(profileDir)) {
      // 恢复会话已结束，允许写入新的健康检查点。
    }
    if (!isRecoveryModeActive(profileDir)) {
      await captureProfileHealthCheckpoint(profileDir).catch(error => {
        console.error('无法保存 DSH 健康配置检查点。', error)
      })
      // The three-slot snapshot system: captureHealthy was previously NEVER called
      // on any launch path, so the recovery page's slots were always genuinely empty
      // even though the read path (listCheckpoints) was fully wired. Capture with the
      // same construction the recovery service uses for reads, so both ends agree on
      // the on-disk layout (userData/health-snapshots/<profile>/slot-N).
      try {
        requireRecovery().checkpointFor(profileDir).captureHealthy()
      } catch (error) {
        console.error('无法保存 DSH 三槽快照。', error)
      }
    }
    return
  }
  if (state.recovery.handlingRendererBootFailure || state.runtime.isQuitting || state.runtime.isRecycling) return
  state.recovery.handlingRendererBootFailure = true
  const plugins = report.plugins ?? []
  const message = report.error ?? (plugins.length === 0
    ? 'DSH 客户端未能完成插件加载。'
    : `以下插件未能加载：${plugins.join('、')}。`)
  try {
    const candidates = await startupRecoveryCandidates(profileDir, message, plugins)
    await failStartupDiagnostic(startupDiagnosticPath(profileDir), {
      stage: 'renderer-loading',
      source,
      message,
      plugins: candidates,
    })
    await writeTextFile(startupErrorLogPath(profileDir), `${message}\n`, 'utf8')
    // 非关键插件异常只保留诊断；不能把有异常的配置确认为完全健康。
    if (source === 'renderer' && report.workbenchReady === true) return
    await presentDshLoadFailure(profileDir, message, candidates)
  } catch (error) {
    console.error('无法处理 DSH 客户端启动失败。', error)
  } finally {
    state.recovery.handlingRendererBootFailure = false
  }
}

/**
 * 恢复页与工作台使用不同的内容视图。先在后台完成工作台导航，
 * 再切换可见视图，避免用户看到按钮点击后页面停留在原处。
 */
/**
 * Thin delegators used by the recovery-scenarios VM test.
 *
 * The test extracts compiled function bodies from `main.js` via regex and runs them
 * in an isolated `vm` context with injected dependencies. The test does not import
 * modules — it works on function source — so the functions it needs MUST exist as
 * top-level functions in `main.js`. These keep their original signatures and delegate
 * to the recovery service, which is the actual owner of this logic.
 */
async function restartDshInRecoveryMode(profileDir: string, destination: 'recovery' | 'workbench' = 'recovery'): Promise<void> {
  await requireRecovery().restartDsh(profileDir, destination)
}

async function recoveryPageStatus(profileDir: string): Promise<Record<string, unknown>> {
  return await requireRecovery().pageStatus(profileDir)
}
async function returnToWorkbenchFromRecovery(): Promise<void> {
  await requireRecovery().returnToWorkbench()
}

function clearRecoverySessionHints(): void {
  requireRecovery().clearSessionHints()
}

async function maybeLeaveRecoveryMode(profileDir: string): Promise<boolean> {
  return await requireRecovery().maybeLeaveRecoveryMode(profileDir)
}

async function openWorkbenchOrRecovery(profileDir: string, serverUrl: string): Promise<void> {
  await requireRecovery().openWorkbenchOrRecovery(profileDir, serverUrl)
}

async function showRecoveryWindow(profileDir: string, failure?: { failureMessage: string, failurePlugins: string[] }): Promise<void> {
  await requireRecovery().showRecoveryWindow(profileDir, failure)
}

/**
 * Locate the plugins that plausibly caused a DSH load failure.
 *
 * Best effort by design: candidate discovery is a heuristic, and failing to find any
 * must not prevent the recovery window from opening — the user still needs the other
 * remedies. So a discovery error is logged and reported as "no candidates".
 */
async function startupRecoveryCandidates(profileDir: string, message: string, plugins: readonly string[] = []): Promise<string[]> {
  try {
    return await findRecoveryCandidates(profileDir, message, plugins)
  } catch (error) {
    console.error('无法定位导致 DSH 加载失败的插件。', error)
    return []
  }
}

async function presentDshLoadFailure(profileDir: string, message: string, candidates: string[]): Promise<void> {
  if (isRecoveryModeActive(profileDir)) {
    await enterRecoveryMode(profileDir, { force: true, suspectedPlugins: candidates, failureMessage: message })
  }
  if (candidates.length > 0 || isRecoveryModeActive(profileDir)) {
    await showRecoveryWindow(profileDir, { failureMessage: message, failurePlugins: candidates })
  } else {
    clearRecoverySessionHints()
    await showStartupWindow(desktopText('DSH 加载失败：', 'DSH failed to load: ') + message.slice(0, 240)
      + desktopText('\n日志：', '\nLog: ') + startupErrorLogPath(profileDir))
  }
}

async function reportStartupFailure(error: unknown, profileDir?: string): Promise<void> {
  const logPath = startupErrorLogPath(profileDir)
  const message = error instanceof Error ? error.message : '未知启动错误。'
  const candidates = profileDir === undefined ? [] : await startupRecoveryCandidates(profileDir, message)
  if (profileDir !== undefined) {
    await failStartupDiagnostic(startupDiagnosticPath(profileDir), {
      stage: state.diagnostics.stage,
      source: 'process',
      message,
      plugins: candidates,
    }).catch(diagnosticError => { console.error('无法记录 DSH 启动失败。', diagnosticError) })
  }
  await writeTextFile(logPath, message + '\n', 'utf8').catch(() => undefined)
  const short = message.split(/\r?\n/)[0]?.slice(0, 240) ?? '未知启动错误。'
  try {
    if (profileDir !== undefined) await presentDshLoadFailure(profileDir, message, candidates)
    else await showStartupWindow(desktopText('启动失败：', 'Startup failed: ') + short + desktopText('\n日志：', '\nLog: ') + logPath)
  } catch (displayError) {
    console.error('显示启动错误页面失败。', displayError)
  }
}

function handleUnexpectedMainError(error: unknown): void {
  console.error('主进程发生未处理异常。', error)
  if (!app.isReady() || state.runtime.isQuitting || state.launch.isReportingUnexpectedError) return
  state.launch.isReportingUnexpectedError = true
  void reportStartupFailure(error)
    .catch(reportError => { console.error('主进程异常报告失败。', reportError) })
    .finally(() => { state.launch.isReportingUnexpectedError = false })
}

function runMainTask(task: Promise<unknown>): void {
  void task.catch(handleUnexpectedMainError)
}


function handleDshIpc(message: unknown): void {
  if (isApplyPluginUpdatesIpc(message)) {
    // A client plugin may emit this IPC after running its own update-all flow.
    // It has the same contract as a profile mutation, so letting it bypass the
    // market queue would still interrupt a batch after its first item.
    scheduleProfileActivationRecycle()
    return
  }
  if (!isDesktopHostMessage(message)) return
  if (isDesktopActionMessage(message)) {
    // Launcher-native side effect requested by the settings plugin.
    if (message.type === 'desktop/action/restart') {
      runMainTask(restartDesktop())
    } else if (message.type === 'desktop/action/terminal/open') {
      openDshTerminal()
    } else if (message.type === 'desktop/action/devtools/toggle') {
      toggleDeveloperTools()
    }
    return
  }
  // Profile create/select/delete requested by the in-profile settings section.
  const requestId = message.requestId
  const reply = (ok: boolean, error?: string): void => {
    state.runtime.server?.send({ type: 'desktop/profile/result', requestId, ok, ...(error === undefined ? {} : { error }) })
  }
  runMainTask((async () => {
    try {
      if (message.type === 'desktop/profile/create') {
        await createWebProfile(message.name)
        console.log(`已创建 profile：${message.name}`)
      } else if (message.type === 'desktop/profile/select') {
        await switchWebProfile(message.name)
      } else if (message.type === 'desktop/profile/delete') {
        deleteWebProfile(message.name)
        console.log(`已删除 profile：${message.name}`)
      }
      reply(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`profile 操作失败：${detail}`)
      reply(false, detail)
    }
  })())
}

const DSH_MARKET_BATCH_POLL_MS = 750
const DSH_MARKET_BATCH_MAX_WAIT_MS = 10 * 60 * 1_000

function scheduleProfileActivationRecycle(): void {
  if (state.runtime.isQuitting || state.runtime.isRecycling) return
  state.launch.profileActivationRecyclePending = true
  state.launch.profileActivationRecycleGeneration += 1
  if (state.launch.profileActivationRecycleTask !== undefined) return
  const task = recycleAfterDshMarketBatch()
  state.launch.profileActivationRecycleTask = task
  runMainTask(task.finally(() => { state.launch.profileActivationRecycleTask = undefined }))
}

async function dshMarketOperationStatus(): Promise<unknown> {
  const url = state.runtime.server?.url
  if (url === undefined) return undefined
  try {
    const response = await fetch(new URL(DSH_MARKET_STATUS_PATH, url), { signal: AbortSignal.timeout(1_000) })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    // dshmarket is optional. A missing, stopped, or old market should retain
    // the normal profile-change restart behavior.
    return undefined
  }
}

async function recycleAfterDshMarketBatch(): Promise<void> {
  while (state.launch.profileActivationRecyclePending && !state.runtime.isQuitting && !state.runtime.isRecycling) {
    state.launch.profileActivationRecyclePending = false
    const generation = state.launch.profileActivationRecycleGeneration
    const settled = await waitForDshMarketBatchToSettle(
      dshMarketOperationStatus,
      () => new Promise(resolve => setTimeout(resolve, DSH_MARKET_BATCH_POLL_MS)),
      { maxWaitMs: DSH_MARKET_BATCH_MAX_WAIT_MS, pollIntervalMs: DSH_MARKET_BATCH_POLL_MS },
    )
    if (!settled) console.warn(`dshmarket 批量更新等待超时（${DSH_MARKET_BATCH_MAX_WAIT_MS}ms），继续重载插件。`)
    if (state.runtime.isQuitting || state.runtime.isRecycling) return
    // Another profile change or update-all IPC arrived during the quiet
    // check. Start the check over rather than restarting a just-continued
    // batch from its first completion boundary.
    if (state.launch.profileActivationRecycleGeneration !== generation) continue
    await recycleDshForPluginUpdate()
  }
}

async function recycleDshForPluginUpdate(): Promise<void> {
  if (state.runtime.isQuitting || state.runtime.isRecycling || state.launch.lastStartOptions === undefined || state.launch.lastSeedOptions === undefined) return
  const startOptions = state.launch.lastStartOptions
  const seedOptions = state.launch.lastSeedOptions
  state.runtime.isRecycling = true
  broadcastShellState()
  try {
    await showStartupWindow(desktopText('加载中', 'Loading'))
    const current = state.runtime.server
    state.runtime.server = undefined
    await current?.stop()
    const started = await startAfterPluginUpdates({
      applyUpdates: async () => {
        const updated = await applyPendingProfileUpdates(seedOptions)
        if (updated.length > 0) console.log('已热更新插件：' + updated.join('、'))
      },
      onUpdateError: async error => {
        const message = error instanceof Error ? error.message : String(error)
        console.error('插件更新失败，继续尝试加载 DSH。', message)
        await writeTextFile(join(app.getPath('userData'), 'plugin-update.log'), `${message}\n`, 'utf8')
      },
      // Plugin updates retried before the launch, so this runs at most once here.
      start: () => launchDsh({
        startDsh,
        startOptions: () => state.launch.lastStartOptions,
        desktopRuntimeDir: () => seedOptions.desktopRuntimeDir,
        setServer: server => { state.runtime.server = server },
        beginDiagnostic: beginDshStartupDiagnostic,
        advanceDiagnostic: advanceDshStartupDiagnostic,
        onUnexpectedExit: handleUnexpectedDshExit,
        onIpcMessage: handleDshIpc,
      }, seedOptions.profileDir),
    })
    await openWorkbenchOrRecovery(seedOptions.profileDir, started.server.url)
  } catch (error) {
    await reportStartupFailure(error, seedOptions.profileDir)
  } finally {
    state.launch.profileWatcher?.sync()
    state.runtime.isRecycling = false
    broadcastShellState()
  }
}

function handleUnexpectedDshExit(message: string): void {
  if (state.runtime.isQuitting || state.runtime.isRecycling) return
  state.runtime.server = undefined
  stopRendererHealthTimer()
  if (state.launch.lastSeedOptions !== undefined) {
    void failStartupDiagnostic(startupDiagnosticPath(state.launch.lastSeedOptions.profileDir), {
      stage: state.diagnostics.stage,
      source: 'process',
      message,
      plugins: [],
    }).catch(error => { console.error('无法记录 DSH 异常退出。', error) })
  }
  const missing = parseUnresolvedBundleError(message)
  if (missing !== undefined && state.launch.lastSeedOptions !== undefined) {
    runMainTask(removeProfileBundle(state.launch.lastSeedOptions.profileDir, missing).then((removed) => {
      if (removed) runMainTask(recycleDshForPluginUpdate())
    }))
    return
  }
  void writeTextFile(startupErrorLogPath(state.launch.lastSeedOptions?.profileDir), `${message}\n`, 'utf8').catch(() => undefined)
  runMainTask(showStartupWindow(desktopText('DSH 已停止运行。请重新启动应用。', 'DSH has stopped. Restart the app.')))
}

function resolveWindowIconPath(): string | undefined {
  return resolveAppIconPath({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  })
}

function resolveShellAsset(name: 'shell.html' | 'shortcuts.html' | 'about.html' | 'settings.html'): string {
  const packaged = join(process.resourcesPath, name)
  return existsSync(packaged) ? packaged : join(app.getAppPath(), 'assets', name)
}

function resolvePreload(name: 'shell-preload.cjs' | 'dsh-view-preload.cjs' | 'recovery-preload.cjs'): string {
  return join(app.getAppPath(), 'dist', 'src', name)
}

// Window/view ownership lives in desktop/window-registry.ts. These thin wrappers
// keep the existing call sites readable and bind the registry to the app's
// real collaborators once, at startup.
let windowRegistry: WindowRegistry | undefined

function requireWindowRegistry(): WindowRegistry {
  if (windowRegistry === undefined) throw new Error('窗口注册表尚未初始化。')
  return windowRegistry
}

// Notification / update / tray ownership lives in their own modules. As with the
// window registry, each is bound once at startup so its injected dependencies
// (the cycle-breaking callbacks) are visible in exactly one place.
let notificationService: NotificationService | undefined
let updateService: UpdateService | undefined
let trayService: TrayService | undefined

function requireNotificationService(): NotificationService {
  if (notificationService === undefined) throw new Error('通知服务尚未初始化。')
  return notificationService
}

function requireUpdateService(): UpdateService {
  if (updateService === undefined) throw new Error('更新服务尚未初始化。')
  return updateService
}

function requireTrayService(): TrayService {
  if (trayService === undefined) throw new Error('托盘服务尚未初始化。')
  return trayService
}

// The terminal is the narrow-interface case: it needs ONE store field
// (`lastSeedOptions`) and nothing else, so its deps object says exactly that.
let terminalService: TerminalService | undefined

function requireTerminalService(): TerminalService {
  if (terminalService === undefined) throw new Error('终端服务尚未初始化。')
  return terminalService
}

// The three auxiliary windows. Their handles stay on the store; this service reads
// and writes them through accessors so the late-binding contract is preserved.
let dialogService: DialogService | undefined

function requireDialogService(): DialogService {
  if (dialogService === undefined) throw new Error('对话框服务尚未初始化。')
  return dialogService
}

// Profile management and launcher-native desktop actions.
let profileActions: ProfileActionsService | undefined

function requireProfileActions(): ProfileActionsService {
  if (profileActions === undefined) throw new Error('profile 操作服务尚未初始化。')
  return profileActions
}

// Theme application and shell-state broadcast — a cross-cutting concern called from
// the shell IPC, tray, window registry and dialog service.
let shellBroadcast: ShellBroadcastService | undefined

function requireShellBroadcast(): ShellBroadcastService {
  if (shellBroadcast === undefined) throw new Error('外壳广播服务尚未初始化。')
  return shellBroadcast
}

// Restart orchestration: confirmation + full-application relaunch (used to enter
// recovery mode, which is a property of the NEXT process, not this one).
let restartService: RestartService | undefined

function requireRestartService(): RestartService {
  if (restartService === undefined) throw new Error('重启服务尚未初始化。')
  return restartService
}

let shellIpcRegistrar: ShellIpcRegistrar | undefined

function requireShellIpcRegistrar(): ShellIpcRegistrar {
  if (shellIpcRegistrar === undefined) throw new Error('外壳 IPC 注册器尚未初始化。')
  return shellIpcRegistrar
}

function requireDshView(): WebContentsView {
  return requireWindowRegistry().requireDshView()
}

// The recovery flow service; bound once in startApplication.
let recovery: RecoveryService | undefined

function requireRecovery(): RecoveryService {
  if (recovery === undefined) throw new Error('恢复服务尚未初始化。')
  return recovery
}

function requireRecoveryView(): WebContentsView {
  return requireWindowRegistry().requireRecoveryView()
}

function showDshContentView(): void {
  requireWindowRegistry().showDshContentView()
}

function showRecoveryContentView(): void {
  requireWindowRegistry().showRecoveryContentView()
}

function createWindow(): BrowserWindow {
  return requireWindowRegistry().ensureMainWindow()
}

function currentShellState(): ShellState {
  return requireShellBroadcast().currentShellState()
}

function shellBootstrap(): ShellBootstrap {
  return requireShellBroadcast().shellBootstrap()
}

function broadcastShellBootstrap(): void {
  requireShellBroadcast().broadcastShellBootstrap()
}

function setWindowBackground(window: BrowserWindow | undefined, color: string): void {
  requireShellBroadcast().setWindowBackground(window, color)
}

function applyDesktopTheme(colorScheme: DesktopColorScheme, preference?: DesktopThemePreference): void {
  requireShellBroadcast().applyDesktopTheme(colorScheme, preference)
}

function broadcastShellState(): void {
  requireShellBroadcast().broadcastShellState()
}

function desktopUpdateSnapshot(): DesktopUpdateSnapshot {
  return requireUpdateService().desktopUpdateSnapshot()
}

function broadcastDesktopUpdateState(): void {
  requireShellBroadcast().broadcastDesktopUpdateState()
}

function setDesktopUpdateStatus(status: DesktopUpdateStatus, checked = false): void {
  requireUpdateService().setDesktopUpdateStatus(status, checked)
}

/**
 * Recovery IPC channel names.
 *
 * NOTE: these are duplicated in `recovery-preload.cts`, which is a CommonJS preload
 * and cannot import this module. The duplication is a known drift hazard — a channel
 * renamed on one side only fails at runtime with "no handler registered", not at
 * compile time. `test/recovery-ipc-contract.test.ts` asserts the two lists match.
 */
const RECOVERY_IPC = {
  activate: 'dsh-recovery:activate',
  getStartupLog: 'dsh-recovery:get-startup-log',
  getStatus: 'dsh-recovery:get-status',
  keepIsolated: 'dsh-recovery:keep-isolated',
  restore: 'dsh-recovery:restore',
  restoreHealthyConfig: 'dsh-recovery:restore-healthy-config',
  returnToWorkbench: 'dsh-recovery:return-to-workbench',
  uninstall: 'dsh-recovery:uninstall',
  listCheckpoints: 'dsh-recovery:list-checkpoints',
  inspectCheckpoint: 'dsh-recovery:inspect-checkpoint',
  restoreCheckpoint: 'dsh-recovery:restore-checkpoint',
  listProfiles: 'dsh-recovery:list-profiles',
  dataDirectory: 'dsh-recovery:data-directory',
  selectDataDirectory: 'dsh-recovery:select-data-directory',
  factoryReset: 'dsh-recovery:factory-reset',
  openTarget: 'dsh-recovery:open-target',
} as const

function requireRecoveryProfile(sender: WebContents): string {
  if (sender !== state.windows.recoveryView?.webContents) throw new Error('恢复操作仅允许由恢复页面发起。')
  if (state.recovery.profileDir === undefined) throw new Error('恢复页面尚未准备完成。')
  return state.recovery.profileDir
}


/**
 * Build the checkpoint manager for the profile being recovered.
 *
 * The harness home comes from the launcher's own resolution (which honours the
 * user's data-directory choice), NOT from `dirname(profileDir, '..', '..')`.
 * Those coincide today, but deriving it independently would silently break the
 * moment a data directory is configured — the same class of mistake that made
 * safe mode's isolation fail earlier.
 */

/**
 * Register the recovery IPC surface.
 *
 * Every handler is a thin translation: validate the sender, then hand the action to
 * the recovery service. The logic — status projection, checkpoint access, plugin
 * operations — lives in the modules that own it, so this stays a routing table rather
 * than a second implementation.
 *
 * A SINGLE dispatcher channel would be tidier, but keeping one channel per action
 * preserves the existing preload contract and its tests, and the recovery service's
 * own allowlist is what actually bounds what the page can reach.
 */
function installRecoveryIpc(): void {
  for (const channel of Object.values(RECOVERY_IPC)) ipcMain.removeHandler(channel)

  /** Validate the sender and require a prepared profile, then run the action. */
  const action = (sender: WebContents, id: RecoveryActionId, payload?: string): Promise<unknown> => {
    requireRecoveryProfile(sender)
    return requireRecovery().perform(id, payload)
  }

  ipcMain.handle(RECOVERY_IPC.getStatus, async event => {
    requireRecoveryProfile(event.sender)
    return requireRecovery().pageStatus(state.recovery.profileDir!)
  })
  ipcMain.handle(RECOVERY_IPC.activate, async event => {
    requireRecoveryProfile(event.sender)
    const profileDir = state.recovery.profileDir!
    const current = await getRecoveryStatus(profileDir)
    if (!current.active) {
      await enterRecoveryMode(profileDir, {
        suspectedPlugins: state.recovery.failurePlugins,
        failureMessage: state.recovery.failureMessage,
      })
    }
    await requireRecovery().restartDsh(profileDir)
    return requireRecovery().pageStatus(profileDir)
  })
  ipcMain.handle(RECOVERY_IPC.keepIsolated, async (event, packageName: unknown) => {
    const profileDir = requireRecoveryProfile(event.sender)
    const status = await getRecoveryStatus(profileDir)
    // Only plugins that are ACTUALLY isolated may be acted on, so a stale page cannot
    // reach an arbitrary package name.
    if (typeof packageName !== 'string' || !status.isolated.some(plugin => plugin.packageName === packageName)) {
      throw new Error('只能操作当前隔离的第三方插件。')
    }
    return status
  })
  ipcMain.handle(RECOVERY_IPC.restore, async (event, packageName: unknown) => {
    if (typeof packageName !== 'string') throw new Error('插件名称不合法。')
    return await action(event.sender, 'restore', packageName)
  })
  ipcMain.handle(RECOVERY_IPC.uninstall, async (event, packageName: unknown) => {
    if (typeof packageName !== 'string') throw new Error('插件名称不合法。')
    return await action(event.sender, 'uninstall', packageName)
  })
  ipcMain.handle(RECOVERY_IPC.restoreHealthyConfig, async event => {
    const profileDir = requireRecoveryProfile(event.sender)
    await restoreProfileHealthCheckpoint(profileDir)
    await leaveRecoveryMode(profileDir)
    requireRecovery().clearSessionHints()
    await requireRecovery().restartDsh(profileDir, 'workbench')
    return requireRecovery().pageStatus(profileDir)
  })
  ipcMain.handle(RECOVERY_IPC.getStartupLog, async event => await action(event.sender, 'startup-log'))
  ipcMain.handle(RECOVERY_IPC.returnToWorkbench, async event => {
    await action(event.sender, 'return-to-workbench')
  })
  ipcMain.handle(RECOVERY_IPC.listCheckpoints, async event => await action(event.sender, 'list-checkpoints'))
  ipcMain.handle(RECOVERY_IPC.inspectCheckpoint, async (event, slotId: unknown) => {
    if (typeof slotId !== 'string') throw new Error('槽位标识不合法。')
    return await action(event.sender, 'inspect-checkpoint', slotId)
  })
  ipcMain.handle(RECOVERY_IPC.listProfiles, async event => await action(event.sender, 'list-profiles'))
  ipcMain.handle(RECOVERY_IPC.restoreCheckpoint, async (event, slotId: unknown) => {
    if (typeof slotId !== 'string') throw new Error('槽位标识不合法。')
    return await action(event.sender, 'restore-checkpoint', slotId)
  })
  // Data directory, factory reset and "open config file". These reach the same
  // service, so the page's reachable surface stays the action allowlist.
  ipcMain.handle(RECOVERY_IPC.dataDirectory, async event => await action(event.sender, 'data-directory'))
  ipcMain.handle(RECOVERY_IPC.selectDataDirectory, async (event, target: unknown) => {
    if (target !== null && typeof target !== 'string') throw new Error('数据目录不合法。')
    return await action(event.sender, 'select-data-directory', target ?? undefined)
  })
  ipcMain.handle(RECOVERY_IPC.factoryReset, async event => await action(event.sender, 'factory-reset'))
  ipcMain.handle(RECOVERY_IPC.openTarget, async (event, target: unknown) => {
    if (!isRecoveryAction(target)) throw new Error('未知的打开目标。')
    return await action(event.sender, target)
  })
}

function installShellIpc(): void {
  requireShellIpcRegistrar().installShellIpc()
}
function shellRendererKind(sender: WebContents): ShellRendererKind {
  return _ipcShellRendererKind(state.windows.mainWindow, state.windows.shortcutsWindow, state.windows.aboutWindow, state.windows.settingsWindow, state.windows.dshView, sender) as ShellRendererKind
}

function isActionEnabled(id: ShellActionId): boolean {
  return _ipcIsActionEnabled(state.runtime, state.launch, state.shell, id)
}

function popupShellMenu(request: ShellMenuPopupRequest): Promise<void> {
  return new Promise(resolve => {
    if (request === null || typeof request !== 'object') { resolve(); return }
    if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) { resolve(); return }
    const window = state.windows.mainWindow
    if (window === undefined || window.isDestroyed()) { resolve(); return }
    const menuId = request.menu as ShellMenuId
    const actions = localizedShellActions(desktopLocale(), process.platform).filter(action => action.menu === menuId)
    if (actions.length === 0) { resolve(); return }
    const template: MenuItemConstructorOptions[] = []
    let group = actions[0]?.group
    for (const action of actions) {
      if (group !== undefined && action.group !== group) template.push({ type: 'separator' })
      group = action.group
      template.push({
        label: action.label,
        enabled: isActionEnabled(action.id),
        ...(action.acceleratorLabel === undefined ? {} : { accelerator: action.acceleratorLabel }),
        click: () => { runMainTask(Promise.resolve(executeShellAction(action.id))) },
      })
    }
    const menu = Menu.buildFromTemplate(template)
    // `popup`'s callback is not delivered consistently when a native Windows
    // menu is dismissed by clicking its owner window. `menu-will-close` is
    // the close lifecycle event, so resolve from either signal exactly once.
    let settled = false
    const close = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    menu.once('menu-will-close', close)
    menu.popup({
      window,
      x: Math.round(request.x),
      y: Math.round(request.y),
      callback: close,
    })
  })
}



function dismissDshSettingsDialog(): void {
  _ipcDismissDshSettingsDialog(state.windows.dshView)
}

function installShortcutHandler(contents: Electron.WebContents): void {
  contents.on('before-input-event', (event, input: Input) => {
    if (input.type !== 'keyDown') return
    const auxiliaryWindow = [state.windows.shortcutsWindow, state.windows.aboutWindow, state.windows.settingsWindow].find(window => window?.webContents === contents)
    const route = escapeRoute({
      key: input.key,
      isAuxiliaryWindow: auxiliaryWindow !== undefined,
      isDesktopSettingsWindow: auxiliaryWindow === state.windows.settingsWindow,
      isMainShell: contents === state.windows.mainWindow?.webContents,
      isDshSettingsDialogVisible: state.shell.settingsDialogVisible,
    })
    if (route === 'close-auxiliary') {
      event.preventDefault()
      auxiliaryWindow?.close()
      return
    }
    if (route === 'dismiss-dsh-settings') {
      event.preventDefault()
      dismissDshSettingsDialog()
      return
    }
    const id = shellActionForShortcut(input, process.platform)
    if (id === undefined || !isActionEnabled(id)) return
    event.preventDefault()
    if (id === 'close-window' && auxiliaryWindow !== undefined) {
      auxiliaryWindow.close()
      return
    }
    runMainTask(Promise.resolve(executeShellAction(id)))
  })
}

function sendDshAction(id: DshShellActionId): void {
  _ipcSendDshAction(state.windows.dshView, id)
}

async function executeShellAction(id: ShellActionId): Promise<void> {
  if (!isActionEnabled(id)) return
  const contents = state.windows.dshView?.webContents
  if (id === 'new-chat' || id === 'open-folder' || id === 'settings' || id === 'toggle-sidebar' || id === 'find' || id === 'previous-chat' || id === 'next-chat' || id === 'back' || id === 'forward') {
    sendDshAction(id)
    return
  }
  if (id === 'close-window') { state.windows.mainWindow?.hide(); return }
  if (id === 'desktop-settings') { showDesktopSettingsWindow(); return }
  if (id === 'quit') { await requestQuit(); return }
  if (contents === undefined) return
  if (id === 'undo') contents.undo()
  else if (id === 'redo') contents.redo()
  else if (id === 'cut') contents.cut()
  else if (id === 'copy') contents.copy()
  else if (id === 'paste') contents.paste()
  else if (id === 'delete') contents.delete()
  else if (id === 'select-all') contents.selectAll()
  else if (id === 'zoom-in') contents.setZoomFactor(Math.min(2, contents.getZoomFactor() + 0.1))
  else if (id === 'zoom-out') contents.setZoomFactor(Math.max(0.5, contents.getZoomFactor() - 0.1))
  else if (id === 'zoom-reset') contents.setZoomFactor(1)
  else if (id === 'toggle-fullscreen') state.windows.mainWindow?.setFullScreen(!(state.windows.mainWindow?.isFullScreen() ?? false))
  else if (id === 'show-shortcuts') showShortcutsWindow()
  else if (id === 'reload') await recycleDshForPluginUpdate()
  else if (id === 'check-updates') await checkDesktopUpdate()
  else if (id === 'whats-new') await shell.openExternal('https://github.com/deepseek-ai/deepseek-harness/releases')
  else if (id === 'feedback') await shell.openExternal('https://github.com/deepseek-ai/deepseek-harness/issues/new')
  else if (id === 'about') showAboutWindow()
  broadcastShellState()
}

/** Open the DSH terminal bound to the active profile directory with `dsh` on PATH. */
function openDshTerminal(): void {
  requireTerminalService().openDshTerminal()
}

/** Restart the whole desktop application (clean shutdown, then relaunch). */
async function restartDesktop(): Promise<void> {
  await requireProfileActions().restartDesktop()
}

function launcherProfileRoots(): ReturnType<typeof resolveProfileRoots> {
  return requireProfileActions().launcherProfileRoots()
}

function currentProfilesSnapshot(): ReadonlyArray<ReturnType<typeof listProfiles>[number]> {
  return requireProfileActions().currentProfilesSnapshot()
}

async function createWebProfile(name: string): Promise<void> {
  await requireProfileActions().createWebProfile(name)
}

async function switchWebProfile(name: string): Promise<void> {
  await requireProfileActions().switchWebProfile(name)
}

function deleteWebProfile(name: string): void {
  requireProfileActions().deleteWebProfile(name)
}

function desktopProfileViews(): readonly ProfileOperationView[] {
  return requireProfileActions().desktopProfileViews()
}

async function restartIntoRecoveryFromShell(): Promise<void> {
  await requireProfileActions().restartIntoRecoveryFromShell()
}

function toggleDeveloperTools(): void {
  requireProfileActions().toggleDeveloperTools()
}

/** Invoke a non-popup title-bar tool. */
function runShellTool(tool: ShellToolId): Promise<void> | undefined {
  if (tool === 'terminal') {
    openDshTerminal()
    return
  }
  return undefined
}

/** Popup a native menu for a title-bar tool that exposes a small action menu. */
async function popupShellTool(tool: ShellToolPopupId, x: number, y: number): Promise<void> {
  const window = state.windows.mainWindow
  if (window === undefined || window.isDestroyed()) return
  const zh = isChineseLocale(desktopLocale())
  const items: MenuItemConstructorOptions[] = []
  const push = (label: string, enabled: boolean, action: () => void): void => {
    items.push({ label, enabled, click: () => runMainTask(Promise.resolve(action())) })
  }
  if (tool === 'reload') {
    push(zh ? '重载' : 'Reload', isActionEnabled('reload'), () => executeShellAction('reload'))
    push(zh ? '重启' : 'Restart', !state.runtime.isQuitting, () => restartDesktop())
    push(zh ? '重启到恢复模式' : 'Restart in Recovery Mode', !state.runtime.isQuitting && state.launch.lastSeedOptions !== undefined, () => restartIntoRecoveryFromShell())
  } else {
    push(zh ? '切换开发者工具' : 'Toggle Developer Tools', true, () => toggleDeveloperTools())
  }
  if (items.length === 0) return
  const menu = Menu.buildFromTemplate(items)
  let settled = false
  const close = (): void => { if (!settled) { settled = true } }
  menu.once('menu-will-close', close)
  menu.popup({ window, x: Math.round(x), y: Math.round(y), callback: close })
}

/**
 * Windows resolves a toast's small source icon from a Start Menu shortcut that
 * matches both the running executable and AppUserModelID. Packaged installs get
 * this from electron-builder; isolated test runs need the same registration or
 * Windows falls back to the generic Electron identity shown in the toast header.
 */
function ensureWindowsNotificationIdentity(): void {
  requireNotificationService().ensureWindowsNotificationIdentity()
}

function sendNotificationReplyToDsh(sessionId: string, text: string): void {
  requireNotificationService().sendNotificationReplyToDsh(sessionId, text)
}

function installWindowsNotificationActivationHandler(): void {
  requireNotificationService().installWindowsNotificationActivationHandler()
}

function notificationCopy(event: DesktopNotificationEvent): { title: string; body: string } {
  return requireNotificationService().notificationCopy(event)
}

function updateUnreadCompletionBadge(count: number): void {
  requireNotificationService().updateUnreadCompletionBadge(count)
}

function dismissNotificationsForSession(sessionId: string): void {
  requireNotificationService().dismissNotificationsForSession(sessionId)
}

function focusMainWindowForNotification(): void {
  requireNotificationService().focusMainWindowForNotification()
}

function openNotificationSession(sessionId: string): void {
  requireNotificationService().openNotificationSession(sessionId)
}

function showNotificationReplyError(sessionId: string): void {
  requireNotificationService().showNotificationReplyError(sessionId)
}

function showDesktopNotification(event: DesktopNotificationEvent): void {
  requireNotificationService().showDesktopNotification(event)
}

/**
 * Dispatch a validated notification-bridge event to the right handler.
 *
 * Lives in main.ts rather than the notification service because the `badge` and
 * `dismiss` cases fan out to the service, while `reply-error` and full notifications
 * are the service's own concern — keeping the routing here preserves the original
 * single dispatch point that the IPC registrar calls into.
 */
function handleBridgeNotificationEvent(payload: unknown): void {
  const notificationEvent = parseDesktopNotificationBridgeEvent(payload)
  if (notificationEvent === undefined) return
  if (notificationEvent.type === 'badge') {
    updateUnreadCompletionBadge(notificationEvent.count)
    return
  }
  if (notificationEvent.type === 'dismiss') {
    dismissNotificationsForSession(notificationEvent.sessionId)
    return
  }
  if (notificationEvent.type === 'reply-error') {
    showNotificationReplyError(notificationEvent.sessionId)
    return
  }
  showDesktopNotification(notificationEvent)
}

function removeNativeWindowMenu(window: BrowserWindow): void {
  if (process.platform === 'darwin') return
  window.setMenu(null)
  window.setMenuBarVisibility(false)
}

/** Windows 关闭 parent/modal 子窗时会 EnableWindow 主窗，自定义标题栏会整窗闪一下。关闭前先断开归属。 */
function preventWindowsOwnedWindowFlash(window: BrowserWindow): void {
  window.on('close', () => {
    if (process.platform !== 'win32' || window.isDestroyed() || window.getParentWindow() === null) return
    window.setParentWindow(null)
  })
}

function showDesktopSettingsWindow(section: DesktopSettingsSection = 'notifications'): void {
  requireDialogService().showDesktopSettingsWindow(section)
}

function showShortcutsWindow(): void {
  requireDialogService().showShortcutsWindow()
}

function showAboutWindow(): void {
  requireDialogService().showAboutWindow()
}

function configureDesktopUpdater(): void {
  requireUpdateService().configureDesktopUpdater()
}

function scheduleStartupUpdateCheck(): void {
  requireUpdateService().scheduleStartupUpdateCheck()
}

function createTray(): void {
  requireTrayService().createTray()
}

function refreshTrayMenu(): void {
  requireTrayService().refreshTrayMenu()
}

async function handleTrayUpdateAction(id: string): Promise<void> {
  await requireTrayService().handleTrayUpdateAction(id)
}

type DesktopUpdateInteraction = 'interactive' | 'background' | 'settings'

async function checkDesktopUpdate(interaction: DesktopUpdateInteraction = 'interactive'): Promise<void> {
  await requireUpdateService().checkDesktopUpdate(interaction)
}

async function downloadDesktopUpdate(interaction: DesktopUpdateInteraction = 'interactive'): Promise<void> {
  await requireUpdateService().downloadDesktopUpdate(interaction)
}

async function handleDesktopUpdateSettingsAction(action: DesktopUpdateAction): Promise<void> {
  await requireUpdateService().handleDesktopUpdateSettingsAction(action)
}

const DESKTOP_UPDATE_NOTIFICATION_ID = 'desktop-update'

function dismissDesktopUpdateNotification(): void {
  requireUpdateService().dismissDesktopUpdateNotification()
}

function showDesktopUpdateNotification(kind: 'available' | 'ready', version: string): void {
  requireUpdateService().showDesktopUpdateNotification(kind, version)
}

async function installDesktopUpdate(): Promise<void> {
  await requireUpdateService().installDesktopUpdate()
}

function showMainWindow(): void {
  requireWindowRegistry().showMainWindow()
}
