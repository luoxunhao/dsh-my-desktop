import { app, BrowserWindow, Menu, Notification, Tray, WebContentsView, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, session, shell, type Input, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile, writeFile as writeTextFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
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
  : './dsh-process.js') as DshProcessModule
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

async function startApplication(): Promise<void> {
  await app.whenReady()
  ensureWindowsNotificationIdentity()
  installWindowsNotificationActivationHandler()
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
  installShellIpc()
  installRecoveryIpc()
  installDesktopFaviconReplacement()
  Menu.setApplicationMenu(null)
  configureDesktopUpdater()
  createTray()
  await showStartupWindow(desktopText('正在启动', 'Starting'))

  try {
    const runtimeOptions = {
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }
    const pathPrefix = resolvePluginBinDir(runtimeOptions)
    const pnpmEntry = pathPrefix === undefined ? process.env.npm_execpath : join(pathPrefix, 'pnpm-package', 'bin', 'pnpm.cjs')
    // Launch the persisted active profile (defaults to the legacy "web").
    const profileRoots = resolveProfileRoots({ stateDir: app.getPath('userData') })
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

function resolveRecoveryHtml(): string | undefined {
  const packaged = join(process.resourcesPath, 'recovery.html')
  const development = join(app.getAppPath(), 'assets', 'recovery.html')
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
async function returnToWorkbenchFromRecovery(): Promise<void> {
  const running = state.runtime.server
  if (running === undefined) throw new Error('DSH 尚未成功启动，无法进入工作台。')
  const view = requireDshView()
  const profileDir = state.recovery.profileDir
  if (profileDir !== undefined) {
    await advanceDshStartupDiagnostic(profileDir, 'renderer-loading')
    startRendererHealthTimer(profileDir)
  }
  state.shell.allowedOrigin = new URL(running.url).origin
  await windowNavigation.navigate(view, () => view.webContents.loadURL(running.url))
  showDshContentView()
  state.windows.mainWindow?.maximize()
  state.windows.mainWindow?.show()
  state.windows.mainWindow?.focus()
  if (profileDir !== undefined) await maybeLeaveRecoveryMode(profileDir)
}

function clearRecoverySessionHints(): void {
  state.recovery.failureMessage = undefined
  state.recovery.failurePlugin = undefined
  state.recovery.failurePlugins = []
}

async function maybeLeaveRecoveryMode(profileDir: string): Promise<boolean> {
  if (!await tryAutoLeaveRecoveryMode(profileDir)) return false
  clearRecoverySessionHints()
  return true
}

async function openWorkbenchOrRecovery(profileDir: string, serverUrl: string): Promise<void> {
  if (isRecoveryModeActive(profileDir)) {
    if (await maybeLeaveRecoveryMode(profileDir)) {
      await createMainWindow(serverUrl)
      return
    }
    await showRecoveryWindow(profileDir)
    return
  }
  await createMainWindow(serverUrl)
}

async function showRecoveryWindow(profileDir: string, failure?: { failureMessage: string, failurePlugins: string[] }): Promise<void> {
  stopRendererHealthTimer()
  const window = createWindow()
  // The recovery page drops the workbench's larger minimum size so it fits on
  // small screens; the DSH view restores it via showDshContentView().
  window.setMinimumSize(720, 520)
  if (window.isMaximized()) window.unmaximize()
  window.setSize(920, 680)
  window.center()
  const view = requireRecoveryView()
  state.recovery.profileDir = profileDir
  if (failure !== undefined) {
    state.recovery.failureMessage = failure.failureMessage
    state.recovery.failurePlugins = failure.failurePlugins
    state.recovery.failurePlugin = failure.failurePlugins[0]
  }
  showRecoveryContentView()
  const html = resolveRecoveryHtml()
  if (html === undefined) throw new Error('恢复页面资源缺失。')
  await windowNavigation.navigate(view, () => view.webContents.loadFile(html))
}

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

function requireDshView(): WebContentsView {
  return requireWindowRegistry().requireDshView()
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
  const window = state.windows.mainWindow
  const zoomFactor = state.windows.dshView?.webContents.getZoomFactor() ?? 1
  return {
    ...state.shell.navigationState,
    fullscreen: window?.isFullScreen() ?? false,
    reloading: state.runtime.isRecycling,
    zoomPercent: Math.round(zoomFactor * 100),
  }
}

function shellBootstrap(): ShellBootstrap {
  const locale = desktopLocale()
  return {
    actions: localizedShellActions(locale, process.platform),
    colorScheme: state.shell.colorScheme,
    locale,
    menus: localizedShellMenus(locale),
    platform: process.platform,
    runtimeVersion: OFFICIAL_DSH_VERSION,
    state: currentShellState(),
    version: app.getVersion(),
  }
}

function broadcastShellBootstrap(): void {
  const bootstrap = shellBootstrap()
  for (const window of [state.windows.mainWindow, state.windows.shortcutsWindow, state.windows.aboutWindow, state.windows.settingsWindow]) {
    if (window !== undefined && !window.isDestroyed()) window.webContents.send(SHELL_IPC.bootstrap, bootstrap)
  }
}

function setWindowBackground(window: BrowserWindow | undefined, color: string): void {
  if (window !== undefined && !window.isDestroyed()) window.setBackgroundColor(color)
}

function applyDesktopTheme(colorScheme: DesktopColorScheme, preference?: DesktopThemePreference): void {
  state.shell.colorScheme = colorScheme
  if (preference !== undefined) {
    state.shell.themePreference = preference
    nativeTheme.themeSource = preference
  }
  const palette = DESKTOP_THEME_PALETTES[colorScheme]
  setWindowBackground(state.windows.mainWindow, palette.titleBarBackground)
  setWindowBackground(state.windows.settingsWindow, palette.settingsBackground)
  setWindowBackground(state.windows.shortcutsWindow, palette.shortcutsBackground)
  setWindowBackground(state.windows.aboutWindow, palette.aboutBackground)
  if (process.platform !== 'darwin' && state.windows.mainWindow !== undefined && !state.windows.mainWindow.isDestroyed()) {
    state.windows.mainWindow.setTitleBarOverlay({ color: palette.titleBarBackground, symbolColor: palette.titleBarSymbol, height: SHELL_BAR_HEIGHT })
  }
}

function broadcastShellState(): void {
  const shellState = currentShellState()
  for (const window of [state.windows.mainWindow, state.windows.shortcutsWindow, state.windows.aboutWindow, state.windows.settingsWindow]) {
    if (window !== undefined && !window.isDestroyed()) window.webContents.send(SHELL_IPC.state, shellState)
  }
}

function desktopUpdateSnapshot(): DesktopUpdateSnapshot {
  return {
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    status: state.update.status,
    ...(state.update.lastUpdateCheckAt === undefined ? {} : { lastCheckedAt: state.update.lastUpdateCheckAt }),
  }
}

function broadcastDesktopUpdateState(): void {
  if (state.windows.settingsWindow !== undefined && !state.windows.settingsWindow.isDestroyed()) {
    state.windows.settingsWindow.webContents.send(SHELL_IPC.desktopUpdateState, desktopUpdateSnapshot())
  }
}

function setDesktopUpdateStatus(status: DesktopUpdateStatus, checked = false): void {
  state.update.status = status
  if (checked) state.update.lastUpdateCheckAt = new Date().toISOString()
  refreshTrayMenu()
  broadcastDesktopUpdateState()
}

const RECOVERY_IPC = {
  activate: 'dsh-recovery:activate',
  getStartupLog: 'dsh-recovery:get-startup-log',
  getStatus: 'dsh-recovery:get-status',
  keepIsolated: 'dsh-recovery:keep-isolated',
  restore: 'dsh-recovery:restore',
  restoreHealthyConfig: 'dsh-recovery:restore-healthy-config',
  returnToWorkbench: 'dsh-recovery:return-to-workbench',
  uninstall: 'dsh-recovery:uninstall',
} as const

function requireRecoveryProfile(sender: WebContents): string {
  if (sender !== state.windows.recoveryView?.webContents) throw new Error('恢复操作仅允许由恢复页面发起。')
  if (state.recovery.profileDir === undefined) throw new Error('恢复页面尚未准备完成。')
  return state.recovery.profileDir
}

async function recoveryPageStatus(profileDir: string): Promise<object> {
  const status = await getRecoveryStatus(profileDir)
  const diagnostic = await readStartupDiagnostic(startupDiagnosticPath(profileDir))
  const checkpoint = await readProfileHealthCheckpoint(profileDir)
  const suspectedPlugin = status.suspectedPlugin ?? state.recovery.failurePlugin
  const failureMessage = state.recovery.failureMessage ?? status.failureMessage
  return {
    ...status,
    running: state.runtime.server !== undefined,
    candidates: state.recovery.failurePlugins.map(packageName => ({ packageName })),
    ...(failureMessage === undefined ? {} : { failureMessage }),
    ...(suspectedPlugin === undefined ? {} : { suspectedPlugin }),
    ...(diagnostic === undefined ? {} : { diagnostic }),
    ...(checkpoint === undefined ? {} : { checkpoint }),
  }
}

async function restartDshInRecoveryMode(profileDir: string, destination: 'recovery' | 'workbench' = 'recovery'): Promise<void> {
  if (state.launch.lastStartOptions === undefined || state.launch.lastSeedOptions === undefined) throw new Error('恢复环境尚未准备完成。')
  state.runtime.isRecycling = true
  broadcastShellState()
  try {
    const current = state.runtime.server
    state.runtime.server = undefined
    await current?.stop()
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
    state.recovery.failureMessage = undefined
    if (destination === 'workbench') {
      await returnToWorkbenchFromRecovery()
    } else {
      await showRecoveryWindow(profileDir)
    }
  } catch (error) {
    await reportStartupFailure(error, profileDir)
    throw error
  } finally {
    state.launch.profileWatcher?.sync()
    state.runtime.isRecycling = false
    broadcastShellState()
  }
}

function installRecoveryIpc(): void {
  for (const channel of Object.values(RECOVERY_IPC)) ipcMain.removeHandler(channel)
  ipcMain.handle(RECOVERY_IPC.getStatus, async event => recoveryPageStatus(requireRecoveryProfile(event.sender)))
  ipcMain.handle(RECOVERY_IPC.activate, async event => {
    const profileDir = requireRecoveryProfile(event.sender)
    const current = await getRecoveryStatus(profileDir)
    if (!current.active) await enterRecoveryMode(profileDir, {
      suspectedPlugins: state.recovery.failurePlugins,
      failureMessage: state.recovery.failureMessage,
    })
    await restartDshInRecoveryMode(profileDir)
    return recoveryPageStatus(profileDir)
  })
  ipcMain.handle(RECOVERY_IPC.keepIsolated, async (event, packageName: unknown) => {
    const profileDir = requireRecoveryProfile(event.sender)
    const status = await getRecoveryStatus(profileDir)
    if (typeof packageName !== 'string' || !status.isolated.some(plugin => plugin.packageName === packageName)) {
      throw new Error('只能操作当前隔离的第三方插件。')
    }
    return status
  })
  ipcMain.handle(RECOVERY_IPC.restore, async (event, packageName: unknown) => {
    const profileDir = requireRecoveryProfile(event.sender)
    if (typeof packageName !== 'string') throw new Error('插件名称不合法。')
    await restoreRecoveryPlugin(profileDir, packageName)
    await restartDshInRecoveryMode(profileDir)
    return recoveryPageStatus(profileDir)
  })
  ipcMain.handle(RECOVERY_IPC.uninstall, async (event, packageName: unknown) => {
    const profileDir = requireRecoveryProfile(event.sender)
    if (typeof packageName !== 'string') throw new Error('插件名称不合法。')
    const status = await uninstallRecoveryPlugin(profileDir, packageName)
    if (state.recovery.failurePlugin === packageName) state.recovery.failurePlugin = undefined
    return status
  })
  ipcMain.handle(RECOVERY_IPC.restoreHealthyConfig, async event => {
    const profileDir = requireRecoveryProfile(event.sender)
    await restoreProfileHealthCheckpoint(profileDir)
    await leaveRecoveryMode(profileDir)
    clearRecoverySessionHints()
    await restartDshInRecoveryMode(profileDir, 'workbench')
    return recoveryPageStatus(profileDir)
  })
  ipcMain.handle(RECOVERY_IPC.getStartupLog, async event => {
    const profileDir = requireRecoveryProfile(event.sender)
    const content = await readFile(startupErrorLogPath(profileDir), 'utf8').catch(() => '')
    return trimStartupLogForRecovery(content)
  })
  ipcMain.handle(RECOVERY_IPC.returnToWorkbench, async event => {
    requireRecoveryProfile(event.sender)
    await returnToWorkbenchFromRecovery()
  })
}

function installShellIpc(): void {
  ipcMain.removeHandler(SHELL_IPC.getBootstrap)
  ipcMain.removeHandler(SHELL_IPC.action)
  ipcMain.removeHandler(SHELL_IPC.tool)
  ipcMain.removeHandler(SHELL_IPC.popupTool)
  ipcMain.removeHandler(SHELL_IPC.popupMenu)
  ipcMain.removeHandler(SHELL_IPC.getNotificationPreferences)
  ipcMain.removeHandler(SHELL_IPC.updateNotificationPreferences)
  ipcMain.removeHandler(SHELL_IPC.getUpdatePreferences)
  ipcMain.removeHandler(SHELL_IPC.updateUpdatePreferences)
  ipcMain.removeHandler(SHELL_IPC.getDesktopUpdateState)
  ipcMain.removeHandler(SHELL_IPC.desktopUpdateAction)
  ipcMain.removeHandler(SHELL_IPC.closeDesktopSettings)
  ipcMain.handle(SHELL_IPC.getBootstrap, event => {
    if (!mayGetShellBootstrap(shellRendererKind(event.sender))) return
    return shellBootstrap()
  })
  ipcMain.handle(SHELL_IPC.action, (event, id: unknown) => {
    if (typeof id !== 'string' || !shellActionIds.has(id)) return
    const actionId = id as ShellActionId
    if (!mayInvokeShellAction(shellRendererKind(event.sender), actionId)) return
    return executeShellAction(actionId)
  })
  ipcMain.handle(SHELL_IPC.tool, (event, tool: unknown) => {
    if (!mayPopupShellMenu(shellRendererKind(event.sender))) return
    if (tool !== 'terminal') return
    return runShellTool('terminal')
  })
  ipcMain.handle(SHELL_IPC.popupTool, (event, tool: unknown, x: unknown, y: unknown) => {
    if (!mayPopupShellMenu(shellRendererKind(event.sender))) return
    if (tool !== 'reload' && tool !== 'developer') return
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    return popupShellTool(tool, Math.round(Number(x)), Math.round(Number(y)))
  })
  ipcMain.handle(SHELL_IPC.popupMenu, (event, request: ShellMenuPopupRequest) => {
    if (!mayPopupShellMenu(shellRendererKind(event.sender))) return
    return popupShellMenu(request)
  })
  ipcMain.handle(SHELL_IPC.getNotificationPreferences, event => {
    if (!mayAccessNotificationPreferences(shellRendererKind(event.sender))) return
    return state.notifications.preferences
  })
  ipcMain.handle(SHELL_IPC.updateNotificationPreferences, async (event, value: unknown) => {
    if (!mayAccessNotificationPreferences(shellRendererKind(event.sender))) return
    state.notifications.preferences = await saveNotificationPreferences(notificationPreferencesPath(), value)
    return state.notifications.preferences
  })
  ipcMain.handle(SHELL_IPC.getUpdatePreferences, event => {
    if (!mayAccessDesktopUpdates(shellRendererKind(event.sender))) return
    return state.update.preferences
  })
  ipcMain.handle(SHELL_IPC.updateUpdatePreferences, async (event, value: unknown) => {
    if (!mayAccessDesktopUpdates(shellRendererKind(event.sender))) return
    state.update.preferences = await saveUpdatePreferences(updatePreferencesPath(), value)
    if (shouldDownloadUpdateAutomatically(state.update.preferences) && state.update.status.kind === 'available') {
      runMainTask(downloadDesktopUpdate('settings'))
    }
    return state.update.preferences
  })
  ipcMain.handle(SHELL_IPC.getDesktopUpdateState, event => {
    if (!mayAccessDesktopUpdates(shellRendererKind(event.sender))) return
    return desktopUpdateSnapshot()
  })
  ipcMain.handle(SHELL_IPC.desktopUpdateAction, async (event, value: unknown) => {
    if (!mayAccessDesktopUpdates(shellRendererKind(event.sender))) return
    if (value !== 'check' && value !== 'download' && value !== 'install') return
    await handleDesktopUpdateSettingsAction(value)
    return desktopUpdateSnapshot()
  })
  ipcMain.handle(SHELL_IPC.closeDesktopSettings, event => {
    if (!mayCloseDesktopSettings(shellRendererKind(event.sender))) return
    state.windows.settingsWindow?.close()
  })
  ipcMain.removeAllListeners(SHELL_IPC.dshState)
  ipcMain.on(SHELL_IPC.dshState, (event, navigation: Partial<DshNavigationState>) => {
    if (!mayReportDshState(shellRendererKind(event.sender))) return
    if (typeof navigation !== 'object' || navigation === null) return
    state.shell.navigationState = {
      canBack: navigation.canBack === true,
      canForward: navigation.canForward === true,
      canNextChat: navigation.canNextChat === true,
      canPreviousChat: navigation.canPreviousChat === true,
    }
    broadcastShellState()
  })
  ipcMain.removeAllListeners(SHELL_IPC.dshBoot)
  ipcMain.on(SHELL_IPC.dshBoot, (event, value: unknown) => {
    if (!mayReportDshBoot(shellRendererKind(event.sender))) return
    runMainTask(handleRendererBootReport(value))
  })
  ipcMain.removeAllListeners(SHELL_IPC.dshLocale)
  ipcMain.on(SHELL_IPC.dshLocale, (event, value: unknown) => {
    if (!mayReportDshLocale(shellRendererKind(event.sender))) return
    const locale = normalizeShellLocale(value)
    if (locale === undefined || locale === state.shell.locale) return
    state.shell.locale = locale
    broadcastShellBootstrap()
    updateUnreadCompletionBadge(state.notifications.unreadCompletionCount)
  })
  ipcMain.removeAllListeners(SHELL_IPC.dshTheme)
  ipcMain.on(SHELL_IPC.dshTheme, (event, value: unknown) => {
    if (!mayReportDshTheme(shellRendererKind(event.sender))) return
    const snapshot = normalizeDesktopThemeSnapshot(value)
    if (snapshot === undefined) return
    const colorSchemeChanged = snapshot.colorScheme !== state.shell.colorScheme
    const preferenceChanged = snapshot.preference !== undefined && snapshot.preference !== state.shell.themePreference
    if (!colorSchemeChanged && !preferenceChanged) return
    applyDesktopTheme(snapshot.colorScheme, snapshot.preference)
    if (colorSchemeChanged) broadcastShellBootstrap()
  })
  ipcMain.removeAllListeners(SHELL_IPC.dshSettingsVisibility)
  ipcMain.on(SHELL_IPC.dshSettingsVisibility, (event, value: unknown) => {
    if (!mayReportDshSettingsVisibility(shellRendererKind(event.sender))) return
    state.shell.settingsDialogVisible = value === true
  })
  ipcMain.removeAllListeners(SHELL_IPC.dshNotification)
  ipcMain.on(SHELL_IPC.dshNotification, (event, value: unknown) => {
    if (!mayReportDshNotification(shellRendererKind(event.sender))) return
    const notificationEvent = parseDesktopNotificationBridgeEvent(value)
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
  })
}

function shellRendererKind(sender: WebContents): ShellRendererKind {
  if (sender === state.windows.mainWindow?.webContents) return 'main'
  if (sender === state.windows.shortcutsWindow?.webContents) return 'shortcuts'
  if (sender === state.windows.aboutWindow?.webContents) return 'about'
  if (sender === state.windows.settingsWindow?.webContents) return 'settings'
  if (sender === state.windows.dshView?.webContents) return 'dsh'
  return 'unknown'
}

function isActionEnabled(id: ShellActionId): boolean {
  if (id === 'reload') return !state.runtime.isRecycling && state.launch.lastStartOptions !== undefined && state.launch.lastSeedOptions !== undefined
  if (id === 'back') return state.shell.navigationState.canBack
  if (id === 'forward') return state.shell.navigationState.canForward
  if (id === 'previous-chat') return state.shell.navigationState.canPreviousChat
  if (id === 'next-chat') return state.shell.navigationState.canNextChat
  return true
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

const DISMISS_DSH_SETTINGS_DIALOG_SCRIPT = `(() => {
  const label = (element) => ((element.getAttribute('aria-label') || '') + ' ' + (element.textContent || '')).replace(/\s+/g, ' ').trim().toLowerCase()
  const dialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
    .find((element) => {
      if (element.offsetParent === null) return false
      const titleId = element.getAttribute('aria-labelledby')
      const title = titleId === null ? null : document.getElementById(titleId)
      return title !== null && /^(设置|settings)$/i.test(label(title))
    })
  if (!dialog) return false
  const close = [...dialog.querySelectorAll('button')]
    .find((element) => /^(关闭|close)$/i.test(label(element)))
  if (!close) return false
  close.click()
  return true
})()`

function dismissDshSettingsDialog(): void {
  const contents = state.windows.dshView?.webContents
  if (contents === undefined || contents.isDestroyed()) return
  void contents.executeJavaScript(DISMISS_DSH_SETTINGS_DIALOG_SCRIPT).catch(() => undefined)
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
  if (state.windows.dshView !== undefined && !state.windows.dshView.webContents.isDestroyed()) state.windows.dshView.webContents.send(SHELL_IPC.dshAction, id)
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
  try {
    const profileDir = state.launch.lastSeedOptions?.profileDir ?? resolveWebProfileDir()
    // The app launches DSH with DSH_HOME = the `.dsh` root two levels above the
    // profile dir (see startDsh). Mirror that so `dsh` resolves the same home.
    const home = state.launch.lastSeedOptions?.profileDir !== undefined ? resolve(profileDir, '..', '..') : app.getPath('home')
    const cwd = existsSync(profileDir) ? profileDir : existsSync(home) ? home : app.getPath('temp')
    // dsh CLI operates on the currently launched profile (the active profile).
    const profileName = state.launch.lastSeedOptions?.profileDir !== undefined
      ? basename(state.launch.lastSeedOptions.profileDir)
      : readActiveProfile(launcherProfileRoots())
    const zh = isChineseLocale(desktopLocale())

    // Expose the bundled `dsh` CLI as a `dsh` shim on PATH so profile commands
    // (e.g. `dsh plugin add <pkg>`) work exactly as in a native DSH terminal.
    // The official CLI requires `--profile <name>`. A thin wrapper rewrites argv
    // (see dsh-term.ts) so a bare `dsh`, `dsh web`, `dsh --dump-config` and
    // `dsh plugin …` all act on the active profile — placing the flag on the
    // `plugin`/`web` subcommand, never the parent, so plugin management works.
    const node = resolveNodeExecutable({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath })
    const nodeBinDir = dirname(node)
    let entry: string | undefined
    const entryCandidates = [
      state.launch.lastSeedOptions?.desktopRuntimeDir,
      profileDir,
    ].filter((dir): dir is string => dir !== undefined)
    for (const root of entryCandidates) {
      const candidate = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      if (existsSync(candidate)) { entry = candidate; break }
    }

    let shimDir: string | undefined
    let welcomePath: string | undefined
    if (entry !== undefined) {
      try {
        // Per-profile private state dir (stable, hashed), mirroring the reference
        // desktop-terminal state layout so a stale partial shim is never reused.
        const identity = createHash('sha256').update(profileName, 'utf8').digest('hex')
        const stateDir = join(app.getPath('userData'), 'cli', identity)
        shimDir = join(stateDir, 'bin')
        mkdirSync(shimDir, { recursive: true })
        // The official CLI requires `--profile <name>`, but its `plugin` (and
        // `web`) subcommand rejects a *parent-level* --profile. Prepending the
        // flag therefore breaks `dsh plugin add <pkg>` (see dsh-term.ts). Run a
        // thin self-contained wrapper that rewrites argv so `--profile web` lands
        // on the `plugin` subcommand itself, then boots the official entry.
        writeFileSync(join(shimDir, 'dsh-term.mjs'), renderTerminalEntry(profileName, entry), 'utf8')
        const termQuoted = join(shimDir, 'dsh-term.mjs').replace(/"/g, '""')
        const nodeQuoted = node.replace(/"/g, '""')
        if (process.platform === 'win32') {
          const shim = '@echo off\r\n"' + nodeQuoted + '" "' + termQuoted + '" %*\r\n'
          writeFileSync(join(shimDir, 'dsh.cmd'), shim, 'utf8')
          writeFileSync(join(shimDir, 'dsh.bat'), shim, 'utf8')
          // Welcome banner: cd into the profile and print the environment + hints.
          const profileDirCmd = profileDir.replace(/"/g, '""')
          const product = app.getVersion()
          const line = (text: string): string => '@echo ' + text.replace(/[<>&|^()%]/g, (m) => '^' + m) + '\r\n'
          const welcome = [
            '@echo off',
            // welcome.cmd is written as UTF-8 but cmd reads batch with the console
            // ANSI codepage, mojibaking the CJK banner. Switch to UTF-8 (65001)
            // before any non-ASCII echo so the banner renders; pure-ASCII lines
            // above it parse fine under any codepage.
            'chcp 65001 >nul',
            'cd /d "' + profileDirCmd + '"',
            line(''),
            line((zh ? 'DSH My Desktop ' : 'DSH My Desktop ') + product + (zh ? ' 终端' : ' terminal')),
            line(zh ? 'Profile: ' + profileName : 'Profile: ' + profileName),
            line(zh ? 'Profile directory: ' + profileDir : 'Profile directory: ' + profileDir),
            line(zh ? 'Harness home: ' + home : 'Harness home: ' + home),
            line(zh ? '命令（不带 --profile 即操作当前 ' + profileName + ' profile）：' : 'Commands (without --profile, these act on the ' + profileName + ' profile):'),
            line('  dsh --dump-config'),
            line('  dsh plugin add <third-party-plugin>'),
            line('  dsh plugin remove <third-party-plugin>'),
            line('  dsh plugin update'),
            line(zh ? '安装/移除插件后请重启 DSH My Desktop。' : 'Restart DSH My Desktop after plugin changes.'),
            line(''),
            '',
          ].join('\r\n')
          welcomePath = join(stateDir, 'welcome.cmd')
          writeFileSync(welcomePath, welcome, 'utf8')
        } else {
          writeFileSync(join(shimDir, 'dsh'),
            '#!/usr/bin/env sh\nexec "' + node + '" "' + termQuoted + '" "$@"\n', 'utf8')
          try { spawn('chmod', ['+x', join(shimDir, 'dsh')], { stdio: 'ignore' }).unref() } catch { /* ignore */ }
        }
      } catch {
        shimDir = undefined // Fall through to a plain terminal if the shim cannot be written.
      }
    }

    // Windows exposes the search path as `Path` (case-insensitive); Node only
    // guarantees it under whichever casing the OS used. Read both and rebuild a
    // single entry so the original PATH is never dropped when we prepend.
    const originalPath = process.platform === 'win32'
      ? (process.env.Path ?? process.env.PATH ?? '')
      : (process.env.PATH ?? '')
    const pathVar = process.platform === 'win32' ? 'Path' : 'PATH'
    const separator = process.platform === 'win32' ? ';' : ':'
    // Prepend the shim dir AND the bundled node dir (so `dsh plugin`, which spawns
    // `pnpm` from PATH, finds the bundled pnpm.cmd) — the system/user PATH is never touched.
    const extraPath: string[] = []
    if (shimDir !== undefined) extraPath.push(shimDir)
    if (process.platform === 'win32') extraPath.push(nodeBinDir)
    const nextPath = extraPath.length === 0 ? originalPath : [...extraPath, originalPath].join(separator)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_HOME: home,
      [pathVar]: nextPath,
    }
    if (process.platform === 'win32' && process.env.PATH !== undefined) delete env.PATH

    if (process.platform === 'win32') {
      // Opening a persistent interactive console from a Windows GUI (Electron)
      // main process must go through a `start` broker: a directly spawned
      // `cmd /K` console child does not stay attached/open (it exits instantly),
      // so we write a tiny broker that uses `start` to open the real interactive
      // window and then exits. This mirrors the reference desktop-terminal.
      const cmd = process.env.ComSpec ?? 'cmd.exe'
      const cmdQuoted = cmd.replace(/"/g, '""')
      const brokerDir = dirname(welcomePath ?? cwd)
      const target = welcomePath !== undefined
        ? cmdQuoted + ' /D /K call "' + welcomePath.replace(/"/g, '""') + '"'
        : cmdQuoted + ' /D /K cd /d "' + cwd.replace(/"/g, '""') + '"'
      const launchCmd = join(brokerDir, 'launch.cmd')
      const broker = [
        '@echo off',
        'start "' + DESKTOP_APP_NAME + '" /D "' + cwd.replace(/"/g, '""') + '" ' + target,
        'exit /b 0',
        '',
      ].join('\r\n')
      writeFileSync(launchCmd, broker, 'utf8')
      // Spawn the broker from its own directory using just the basename. Passing
      // the full quoted path to `cmd /S /C` fails (exit 1) when it contains spaces
      // (e.g. "...\DSH My Desktop\..."), so run `cmd /D /S /C launch.cmd` from the
      // broker dir — the same pattern the reference desktop-terminal uses. The
      // broker itself runs hidden; its `start` creates the visible console.
      const child = spawn(cmd, ['/D', '/S', '/C', 'launch.cmd'], {
        cwd: brokerDir,
        env,
        stdio: 'ignore',
        detached: false,
        windowsHide: true,
      })
      child.once('error', error => { logTerminalError('spawn failed: ' + (error instanceof Error ? error.message : String(error))) })
      child.unref()
      return
    }
    const shell = process.env.SHELL ?? '/bin/bash'
    const child = spawn(shell, ['-l'], { cwd, env, stdio: 'ignore', detached: true })
    child.once('error', error => { logTerminalError('spawn failed: ' + (error instanceof Error ? error.message : String(error))) })
    child.unref()
  } catch (error) {
    // Opening a terminal is best-effort; never take down the host on failure.
    logTerminalError('open failed: ' + (error instanceof Error ? error.stack ?? error.message : String(error)))
  }
}

/** Append a terminal-open diagnostic to userData/terminal.log so failures are visible. */
function logTerminalError(detail: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${detail}\n`
    appendFileSync(join(app.getPath('userData'), 'terminal.log'), line, 'utf8')
  } catch { /* ignore */ }
}

/** Restart the whole desktop application (clean shutdown, then relaunch). */
async function restartDesktop(): Promise<void> {
  if (state.runtime.isQuitting) return
  await shutdownDesktop(() => { app.relaunch(); app.exit() })
}

/** Launcher profile registry roots (state under userData, profiles under DSH home). */
function launcherProfileRoots(): ReturnType<typeof resolveProfileRoots> {
  return resolveProfileRoots({ stateDir: app.getPath('userData') })
}

/** Read-only snapshot of the current managed profiles (for the shell/bridge). */
function currentProfilesSnapshot(): ReadonlyArray<ReturnType<typeof listProfiles>[number]> {
  const roots = launcherProfileRoots()
  const active = readActiveProfile(roots)
  return listProfiles(roots, active)
}

/**
 * Create a new Web profile and seed it with the shared official runtime +
 * bundled plugins. It does NOT select the profile or require a relaunch; a
 * later select/switch starts it.
 */
async function createWebProfile(name: string): Promise<void> {
  assertProfileName(name)
  const roots = launcherProfileRoots()
  createProfileDirectory(roots, name)
  const seed = state.launch.lastSeedOptions
  if (seed === undefined) throw new Error('启动尚未完成，无法创建 profile。')
  // Reuse the current node/pnpm/store plumbing against the new profile dir.
  await seedBundledPlugins({ ...seed, profileDir: profileDirFor(roots.home, name) })
}

/**
 * Select a compatible profile to be active on the next launch, then relaunch
 * the whole desktop application so it starts the newly selected profile.
 */
async function switchWebProfile(name: string): Promise<void> {
  const roots = launcherProfileRoots()
  const target = listProfiles(roots, readActiveProfile(roots)).find((profile) => profile.name === name)
  if (target === undefined) throw new Error(`profile ${JSON.stringify(name)} does not exist`)
  if (!target.selectable) throw new Error(`profile ${JSON.stringify(name)} is not a launchable Web profile`)
  writeActiveProfile(roots, name)
  await restartDesktop()
}

/** Delete a non-active profile directory (fails closed on the active one). */
function deleteWebProfile(name: string): void {
  const roots = launcherProfileRoots()
  deleteProfileDirectory(roots, name, readActiveProfile(roots))
}

/** Renderer-safe view of the managed profiles. */
function desktopProfileViews(): readonly ProfileOperationView[] {
  return currentProfilesSnapshot().map((profile) => ({
    name: profile.name,
    exists: profile.exists,
    webCapable: profile.webCapable,
    selectable: profile.selectable,
    deletable: profile.deletable,
    current: profile.name === readActiveProfile(launcherProfileRoots()),
    problem: profile.problem,
  }))
}

interface ProfileOperationView {
  readonly name: string
  readonly exists: boolean
  readonly webCapable: boolean
  readonly selectable: boolean
  readonly deletable: boolean
  readonly current: boolean
  readonly problem: string | null
}

/** Enter recovery isolation and restart DSH into the recovery window. */
async function restartIntoRecoveryFromShell(): Promise<void> {
  const profileDir = state.launch.lastSeedOptions?.profileDir
  const seedOptions = state.launch.lastSeedOptions
  if (profileDir === undefined || seedOptions === undefined || state.launch.lastStartOptions === undefined) return
  await enterRecoveryMode(profileDir, { force: true })
  await restartDshInRecoveryMode(profileDir)
}

/** Toggle DevTools on the DSH renderer (and the shell page when focused). */
function toggleDeveloperTools(): void {
  const contents = state.windows.dshView?.webContents
  if (contents !== undefined && !contents.isDestroyed()) contents.toggleDevTools()
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

function notificationPreferencesPath(): string {
  return join(app.getPath('userData'), 'desktop-settings.json')
}

function updatePreferencesPath(): string {
  return join(app.getPath('userData'), 'desktop-update-settings.json')
}

/**
 * Windows resolves a toast's small source icon from a Start Menu shortcut that
 * matches both the running executable and AppUserModelID. Packaged installs get
 * this from electron-builder; isolated test runs need the same registration or
 * Windows falls back to the generic Electron identity shown in the toast header.
 */
function ensureWindowsNotificationIdentity(): void {
  if (process.platform !== 'win32') return
  const shortcutDirectories = [
    join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env.ProgramData === undefined ? undefined : join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter((value): value is string => value !== undefined)
  for (const directory of shortcutDirectories) {
    for (const name of [`${DESKTOP_APP_NAME}.lnk`, `${DESKTOP_APP_NAME} Test.lnk`]) {
      const shortcut = join(directory, name)
      if (!existsSync(shortcut)) continue
      try {
        const details = shell.readShortcutLink(shortcut)
        if (resolve(details.target).toLocaleLowerCase() !== resolve(process.execPath).toLocaleLowerCase()) continue
        // 只补 AUMID / toastActivatorClsid 做身份注册，绝不改写图标：
        // 用 notification.ico 覆盖会毁掉 electron-builder 生成的开始菜单快捷方式图标，
        // 进而导致任务栏按钮（按 AUMID 从该快捷方式取图标）变成空白。
        shell.writeShortcutLink(shortcut, 'update', {
          target: details.target,
          appUserModelId: DESKTOP_APP_USER_MODEL_ID,
          toastActivatorClsid: DESKTOP_TOAST_ACTIVATOR_CLSID,
          ...(details.icon === undefined ? {} : { icon: details.icon, iconIndex: details.iconIndex ?? 0 }),
        })
      } catch {
        // A stale or protected shortcut must not prevent the desktop app from starting.
      }
    }
  }
  if (app.isPackaged || !process.argv.some(argument => argument.startsWith('--user-data-dir='))) return
  const icon = resolveNotificationIconPath({ appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath: process.resourcesPath })
  if (icon === undefined) return
  const shortcut = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${DESKTOP_APP_NAME} Test.lnk`)
  const args = process.argv.slice(1)
    .map(argument => /\s|"/.test(argument) ? `"${argument.replaceAll('"', '\\"')}"` : argument)
    .join(' ')
  shell.writeShortcutLink(shortcut, existsSync(shortcut) ? 'replace' : 'create', {
    target: process.execPath,
    args,
    cwd: app.getAppPath(),
    description: `${DESKTOP_APP_NAME} test build`,
    icon,
    iconIndex: 0,
    appUserModelId: DESKTOP_APP_USER_MODEL_ID,
    toastActivatorClsid: DESKTOP_TOAST_ACTIVATOR_CLSID,
  })
}

function sendNotificationReplyToDsh(sessionId: string, text: string): void {
  if (state.windows.dshView === undefined || state.windows.dshView.webContents.isDestroyed()) {
    showNotificationReplyError(sessionId)
    return
  }
  state.windows.dshView.webContents.send(SHELL_IPC.dshNotificationReply, { sessionId, text })
}

function installWindowsNotificationActivationHandler(): void {
  if (process.platform !== 'win32') return
  Notification.handleActivation(details => {
    const reply = parseWindowsNotificationReplyActivation(details)
    if (reply === undefined) return
    sendNotificationReplyToDsh(reply.sessionId, reply.text)
  })
}

function notificationCopy(event: DesktopNotificationEvent): { title: string; body: string } {
  const zh = isChineseLocale(desktopLocale())
  const status = event.kind === 'approval'
    ? (zh ? '需要审批' : 'Approval required')
    : event.kind === 'question'
      ? (zh ? '需要你的输入' : 'Your input is needed')
      : (zh ? '任务已完成' : 'Task completed')
  const title = event.title === undefined ? status : `${status} · ${event.title}`
  if (event.body !== undefined) {
    return { title, body: event.body }
  }
  const task = event.title === undefined
    ? (zh ? 'DeepSeek Harness 任务' : 'DeepSeek Harness task')
    : `“${event.title}”`
  if (event.kind === 'approval') return { title, body: zh ? `${task}正在等待审批` : `${task} is waiting for approval` }
  if (event.kind === 'question') return { title, body: zh ? `${task}正在等待你的回答` : `${task} is waiting for your answer` }
  return { title, body: zh ? `${task}已完成` : `${task} is complete` }
}

function updateUnreadCompletionBadge(count: number): void {
  state.notifications.unreadCompletionCount = count
  if (process.platform === 'win32' && state.windows.mainWindow !== undefined && !state.windows.mainWindow.isDestroyed()) {
    if (count === 0) {
      state.windows.mainWindow.setOverlayIcon(null, '')
    } else {
      const iconPath = resolveTaskBadgeIconPath({ appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath: process.resourcesPath }, count)
      const overlay = nativeImage.createFromPath(iconPath)
      if (!overlay.isEmpty()) {
        const description = isChineseLocale(desktopLocale()) ? `${count} 个已完成任务` : `${count} completed tasks`
        state.windows.mainWindow.setOverlayIcon(overlay, description)
      }
    }
  } else if (process.platform === 'darwin' || process.platform === 'linux') {
    app.setBadgeCount(count)
  }
  refreshTrayMenu()
}

function dismissNotificationsForSession(sessionId: string): void {
  for (const [id, notification] of state.notifications.active) {
    if (!id.endsWith(`:${sessionId}`)) continue
    notification.close()
    state.notifications.active.delete(id)
  }
}

function focusMainWindowForNotification(): void {
  showMainWindow()
  if (process.platform !== 'win32' || state.windows.mainWindow === undefined) return
  state.windows.mainWindow.setAlwaysOnTop(true)
  state.windows.mainWindow.focus()
  state.windows.mainWindow.setAlwaysOnTop(false)
}

function openNotificationSession(sessionId: string): void {
  focusMainWindowForNotification()
  if (state.windows.dshView !== undefined && !state.windows.dshView.webContents.isDestroyed()) {
    state.windows.dshView.webContents.send(SHELL_IPC.dshOpenSession, sessionId)
  }
}

function showNotificationReplyError(sessionId: string): void {
  if (!Notification.isSupported()) return
  const zh = isChineseLocale(desktopLocale())
  const id = `reply-error:${sessionId}`
  state.notifications.active.get(id)?.close()
  const notification = new Notification({
    title: zh ? '回复发送失败' : 'Reply not sent',
    body: zh ? '未能将回复发送到这个任务。请打开任务后重试。' : 'The reply could not be sent to this task. Open it and try again.',
    timeoutType: 'never',
  })
  state.notifications.active.set(id, notification)
  notification.on('click', () => {
    openNotificationSession(sessionId)
    dismissNotificationsForSession(sessionId)
  })
  notification.on('close', () => {
    if (state.notifications.active.get(id) === notification) state.notifications.active.delete(id)
  })
  notification.show()
}

function showDesktopNotification(event: DesktopNotificationEvent): void {
  if (!Notification.isSupported()) return
  if (!shouldShowDesktopNotification(event, state.notifications.preferences, state.windows.mainWindow?.isFocused() ?? false)) return
  const id = `${event.kind}:${event.sessionId}`
  state.notifications.active.get(id)?.close()
  const copy = notificationCopy(event)
  const supportsReply = event.kind !== 'approval' && (process.platform === 'win32' || process.platform === 'darwin')
  const zh = isChineseLocale(desktopLocale())
  const replyPlaceholder = zh ? `回复 ${DESKTOP_APP_NAME}` : `Reply to ${DESKTOP_APP_NAME}`
  const toastId = `dsh-${createHash('sha256').update(id).digest('hex').slice(0, 40)}`
  const notification = new Notification({
    ...copy,
    ...(supportsReply ? {
      hasReply: true,
      replyPlaceholder,
    } : {}),
    ...(supportsReply && process.platform === 'win32' ? {
      id: toastId,
      toastXml: buildWindowsReplyToastXml({
        ...copy,
        id: toastId,
        persistent: event.kind !== 'turn-complete',
        placeholder: replyPlaceholder,
        replyLabel: zh ? '回复' : 'Reply',
        replyArguments: windowsNotificationReplyArguments(event.sessionId),
        closeLabel: zh ? '关闭' : 'Close',
      }),
    } : {}),
    ...(event.kind === 'turn-complete' ? {} : { timeoutType: 'never' }),
  })
  state.notifications.active.set(id, notification)
  notification.on('click', () => {
    openNotificationSession(event.sessionId)
    dismissNotificationsForSession(event.sessionId)
  })
  if (supportsReply && process.platform !== 'win32') {
    notification.on('reply', (details, legacyReply) => {
      const text = (details.reply ?? legacyReply).trim().slice(0, 4_000)
      if (text === '') return
      sendNotificationReplyToDsh(event.sessionId, text)
    })
  }
  notification.on('close', () => {
    if (state.notifications.active.get(id) === notification) state.notifications.active.delete(id)
  })
  notification.show()
}

type DesktopSettingsSection = 'notifications' | 'updates'

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
  if (state.windows.settingsWindow !== undefined && !state.windows.settingsWindow.isDestroyed()) {
    state.windows.settingsWindow.show()
    state.windows.settingsWindow.focus()
    state.windows.settingsWindow.webContents.send(SHELL_IPC.settingsSection, section)
    return
  }
  const window = new BrowserWindow({
    parent: state.windows.mainWindow,
    width: 760,
    height: 620,
    minWidth: 680,
    minHeight: 540,
    title: desktopText('桌面端设置', 'Desktop Settings'),
    autoHideMenuBar: true,
    backgroundColor: DESKTOP_THEME_PALETTES[state.shell.colorScheme].settingsBackground,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: resolvePreload('shell-preload.cjs'), sandbox: true },
  })
  removeNativeWindowMenu(window)
  preventWindowsOwnedWindowFlash(window)
  state.windows.settingsWindow = window
  window.on('closed', () => { if (state.windows.settingsWindow === window) state.windows.settingsWindow = undefined })
  installShortcutHandler(window.webContents)
  window.webContents.once('did-finish-load', () => {
    window.webContents.send(SHELL_IPC.settingsSection, section)
    window.webContents.send(SHELL_IPC.desktopUpdateState, desktopUpdateSnapshot())
  })
  runMainTask(window.loadFile(resolveShellAsset('settings.html'), { query: { theme: state.shell.colorScheme } }))
}

function showShortcutsWindow(): void {
  if (state.windows.shortcutsWindow !== undefined && !state.windows.shortcutsWindow.isDestroyed()) {
    state.windows.shortcutsWindow.show(); state.windows.shortcutsWindow.focus(); return
  }
  const window = new BrowserWindow({
    parent: state.windows.mainWindow,
    modal: true,
    width: 620,
    height: 650,
    minWidth: 520,
    minHeight: 480,
    title: desktopText('键盘快捷键', 'Keyboard Shortcuts'),
    autoHideMenuBar: true,
    backgroundColor: DESKTOP_THEME_PALETTES[state.shell.colorScheme].shortcutsBackground,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: resolvePreload('shell-preload.cjs'), sandbox: true },
  })
  removeNativeWindowMenu(window)
  preventWindowsOwnedWindowFlash(window)
  state.windows.shortcutsWindow = window
  window.on('closed', () => { if (state.windows.shortcutsWindow === window) state.windows.shortcutsWindow = undefined })
  installShortcutHandler(window.webContents)
  runMainTask(window.loadFile(resolveShellAsset('shortcuts.html'), { query: { theme: state.shell.colorScheme } }))
}

function showAboutWindow(): void {
  if (state.windows.aboutWindow !== undefined && !state.windows.aboutWindow.isDestroyed()) {
    state.windows.aboutWindow.show()
    state.windows.aboutWindow.focus()
    return
  }
  const icon = resolveWindowIconImage()
  const window = new BrowserWindow({
    parent: state.windows.mainWindow,
    modal: true,
    width: 560,
    height: 680,
    minWidth: 560,
    minHeight: 680,
    maxWidth: 560,
    maxHeight: 680,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: desktopText(`关于 ${DESKTOP_APP_NAME}`, `About ${DESKTOP_APP_NAME}`),
    autoHideMenuBar: true,
    backgroundColor: DESKTOP_THEME_PALETTES[state.shell.colorScheme].aboutBackground,
    ...(icon === undefined ? {} : { icon }),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: resolvePreload('shell-preload.cjs'), sandbox: true },
  })
  removeNativeWindowMenu(window)
  preventWindowsOwnedWindowFlash(window)
  state.windows.aboutWindow = window
  window.on('closed', () => { if (state.windows.aboutWindow === window) state.windows.aboutWindow = undefined })
  installShortcutHandler(window.webContents)
  runMainTask(window.loadFile(resolveShellAsset('about.html'), { query: { theme: state.shell.colorScheme } }))
}

function configureDesktopUpdater(): void {
  autoUpdater.logger = console
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  const channel = desktopUpdateChannel()
  if (channel !== undefined) {
    autoUpdater.channel = channel
    autoUpdater.allowDowngrade = false
  }
  autoUpdater.on('download-progress', progress => {
    setDesktopUpdateStatus({ kind: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', info => {
    setDesktopUpdateStatus({ kind: 'ready', version: info.version })
  })
  autoUpdater.on('error', error => {
    setDesktopUpdateStatus({ kind: 'error', message: publicDesktopUpdateError(error, desktopLocale()) })
  })
}

function scheduleStartupUpdateCheck(): void {
  if (state.update.startupUpdateTimer !== undefined || !shouldCheckForUpdatesOnStartup(state.update.preferences, app.isPackaged)) return
  state.update.startupUpdateTimer = setTimeout(() => {
    state.update.startupUpdateTimer = undefined
    if (!state.runtime.isQuitting && shouldCheckForUpdatesOnStartup(state.update.preferences, app.isPackaged)) {
      runMainTask(checkDesktopUpdate('background'))
    }
  }, STARTUP_UPDATE_CHECK_DELAY_MS)
}

function createTray(): void {
  if (state.runtime.tray !== undefined) {
    refreshTrayMenu()
    return
  }
  const rasterPath = resolveRasterIconPath({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  })
  const source = rasterPath === undefined ? nativeImage.createEmpty() : nativeImage.createFromPath(rasterPath)
  const icon = source.isEmpty()
    ? nativeImage.createEmpty()
    : source
        .crop(resolveCompactIconCrop(source.getSize()))
        .resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE, quality: 'best' })
  try {
    state.runtime.tray = new Tray(icon)
  } catch {
    return
  }
  state.runtime.tray.on('click', () => showMainWindow())
  refreshTrayMenu()
}

function refreshTrayMenu(): void {
  if (state.runtime.tray === undefined) return
  const badgeSuffix = state.notifications.unreadCompletionCount > 0
    ? (isChineseLocale(desktopLocale()) ? ` · ${state.notifications.unreadCompletionCount} 个已完成任务` : ` · ${state.notifications.unreadCompletionCount} completed tasks`)
    : ''
  state.runtime.tray.setToolTip(DESKTOP_APP_NAME + badgeSuffix)
  const items = buildDesktopTrayItems({
    status: state.update.status,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    locale: desktopLocale(),
  })
  state.runtime.tray.setContextMenu(Menu.buildFromTemplate(items.map(item => {
    if (item.type === 'separator') return { type: 'separator' }
    return {
      label: item.label,
      enabled: item.enabled,
      click: () => { runMainTask(handleTrayUpdateAction(item.id)) },
    }
  })))
}

async function handleTrayUpdateAction(id: string): Promise<void> {
  if (id === 'show') {
    showMainWindow()
    return
  }
  if (id === 'reload') {
    await recycleDshForPluginUpdate()
    return
  }
  if (id === 'quit') {
    await requestQuit()
    return
  }
  if (id === 'check') {
    await checkDesktopUpdate()
    return
  }
  if (id === 'download') {
    await downloadDesktopUpdate()
    return
  }
  if (id === 'install') {
    await installDesktopUpdate()
  }
}

type DesktopUpdateInteraction = 'interactive' | 'background' | 'settings'

async function checkDesktopUpdate(interaction: DesktopUpdateInteraction = 'interactive'): Promise<void> {
  if (state.update.status.kind === 'checking' || state.update.status.kind === 'downloading') return
  if (!app.isPackaged) {
    if (interaction === 'interactive') {
      await dialog.showMessageBox({
        type: 'info',
        title: DESKTOP_APP_NAME,
        message: desktopText('开发态不能检查安装包更新，请使用发布的安装包。', 'Update checks are unavailable in development builds. Use a released installer.'),
      })
    }
    return
  }
  setDesktopUpdateStatus({ kind: 'checking' })
  try {
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo.version
    if (result?.isUpdateAvailable !== true || version === undefined || version === app.getVersion()) {
      setDesktopUpdateStatus({ kind: 'none' }, true)
      dismissDesktopUpdateNotification()
      if (interaction === 'interactive') {
        await dialog.showMessageBox({
          type: 'info',
          title: DESKTOP_APP_NAME,
          message: desktopText('当前已是最新桌面端版本。', 'You already have the latest desktop version.'),
        })
      }
      return
    }
    const available: Extract<DesktopUpdateStatus, { kind: 'available' }> = { kind: 'available', version, releaseNotes: formatDesktopReleaseNotes(result?.updateInfo.releaseNotes) }
    setDesktopUpdateStatus(available, true)
    if (interaction === 'background') {
      if (shouldDownloadUpdateAutomatically(state.update.preferences)) await downloadDesktopUpdate('background')
      else showDesktopUpdateNotification('available', version)
      return
    }
    if (interaction === 'settings') return
    const prompt = await dialog.showMessageBox({
      type: 'question',
      title: DESKTOP_APP_NAME,
      message: desktopUpdatePrompt(available, desktopLocale()),
      buttons: [desktopText('下载并安装', 'Download and Install'), desktopText('取消', 'Cancel')],
      defaultId: 0,
      cancelId: 1,
    })
    if (prompt.response === 0) await downloadDesktopUpdate('interactive')
  } catch (error) {
    const message = publicDesktopUpdateError(error, desktopLocale())
    setDesktopUpdateStatus({ kind: 'error', message }, true)
    if (interaction === 'interactive') {
      await dialog.showMessageBox({
        type: 'error',
        title: DESKTOP_APP_NAME,
        message,
      })
    }
  }
}

async function downloadDesktopUpdate(interaction: DesktopUpdateInteraction = 'interactive'): Promise<void> {
  if (state.update.status.kind !== 'available') return
  const version = state.update.status.version
  setDesktopUpdateStatus({ kind: 'downloading', percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
    const ready = { kind: 'ready' as const, version }
    setDesktopUpdateStatus(ready)
    if (interaction === 'background') {
      showDesktopUpdateNotification('ready', version)
      return
    }
    if (interaction === 'settings') return
    const prompt = await dialog.showMessageBox({
      type: 'question',
      title: DESKTOP_APP_NAME,
      message: desktopUpdatePrompt(ready, desktopLocale()),
      buttons: [desktopText('现在安装', 'Install Now'), desktopText('稍后', 'Later')],
      defaultId: 0,
      cancelId: 1,
    })
    if (prompt.response === 0) await installDesktopUpdate()
  } catch (error) {
    const message = publicDesktopUpdateError(error, desktopLocale())
    setDesktopUpdateStatus({ kind: 'error', message })
    if (interaction === 'interactive') {
      await dialog.showMessageBox({
        type: 'error',
        title: DESKTOP_APP_NAME,
        message,
      })
    }
  }
}

async function handleDesktopUpdateSettingsAction(action: DesktopUpdateAction): Promise<void> {
  if (action === 'check') await checkDesktopUpdate('settings')
  else if (action === 'download') await downloadDesktopUpdate('settings')
  else await installDesktopUpdate()
}

const DESKTOP_UPDATE_NOTIFICATION_ID = 'desktop-update'

function dismissDesktopUpdateNotification(): void {
  state.notifications.active.get(DESKTOP_UPDATE_NOTIFICATION_ID)?.close()
  state.notifications.active.delete(DESKTOP_UPDATE_NOTIFICATION_ID)
}

function showDesktopUpdateNotification(kind: 'available' | 'ready', version: string): void {
  if (!Notification.isSupported()) return
  dismissDesktopUpdateNotification()
  const icon = resolveNotificationIconPath({ appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath: process.resourcesPath })
  const notification = new Notification({
    title: DESKTOP_APP_NAME,
    body: kind === 'ready'
      ? desktopText(`桌面端 ${version} 已下载，点击选择安装时间。`, `Desktop ${version} is ready. Click to choose when to install.`)
      : desktopText(`发现桌面端 ${version}，点击查看更新。`, `Desktop ${version} is available. Click to review the update.`),
    ...(icon === undefined ? {} : { icon }),
  })
  state.notifications.active.set(DESKTOP_UPDATE_NOTIFICATION_ID, notification)
  notification.on('click', () => {
    showDesktopSettingsWindow('updates')
    dismissDesktopUpdateNotification()
  })
  notification.on('close', () => {
    if (state.notifications.active.get(DESKTOP_UPDATE_NOTIFICATION_ID) === notification) state.notifications.active.delete(DESKTOP_UPDATE_NOTIFICATION_ID)
  })
  notification.show()
}

async function installDesktopUpdate(): Promise<void> {
  await shutdownDesktop(() => { autoUpdater.quitAndInstall(false, true) })
}

function showMainWindow(): void {
  requireWindowRegistry().showMainWindow()
}
