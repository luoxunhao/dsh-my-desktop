/**
 * Desktop update lifecycle: status, preferences, check / download / install.
 *
 * CYCLES BROKEN BY INJECTION, NOT BY AN EVENT BUS
 * -----------------------------------------------
 * The tightest cycle in the original file was here:
 *   - `setDesktopUpdateStatus` → `refreshTrayMenu()`   (tray reflects update state)
 *   - `refreshTrayMenu`        → `buildDesktopTrayItems({ status })` (reads it back)
 * Both directions therefore arrive as injected callbacks. See the ADR for why
 * explicit callbacks were chosen over an event bus.
 *
 * This module also owns the updater's own native notification, which is stored in
 * the SHARED active-notification set — the reason notifications and updater are
 * extracted as one ticket: splitting them would leave that set half-owned.
 */
import { app, dialog, Notification } from 'electron'
import updater from 'electron-updater'
import { join } from 'node:path'

import { DESKTOP_APP_NAME } from '../app/app-identity.js'
import { resolveNotificationIconPath } from '../app/app-icon.js'
import {
  STARTUP_UPDATE_CHECK_DELAY_MS,
  desktopUpdateChannel,
  desktopUpdatePrompt,
  formatDesktopReleaseNotes,
  loadUpdatePreferences,
  publicDesktopUpdateError,
  shouldCheckForUpdatesOnStartup,
  shouldDownloadUpdateAutomatically,
  type DesktopUpdateAction,
  type DesktopUpdateStatus,
} from './desktop-updater.js'
import type { NotificationState, UpdateState } from './desktop-state.js'

const { autoUpdater } = updater

/** The updater's own toast is tracked by a fixed id in the shared set. */
const DESKTOP_UPDATE_NOTIFICATION_ID = 'desktop-update'

export interface UpdateDeps {
  update: UpdateState
  notifications: NotificationState
  /** Current shell locale, used to pick zh/en copy. */
  locale: () => string
  /** Localized string helper bound to the shell locale. */
  text: (zh: string, en: string) => string
  /** Non-quitting guard read at call time. */
  isQuitting: () => boolean
  /** Refresh the tray menu so it reflects the new update status. */
  refreshTrayMenu: () => void
  /** Push the update snapshot to shell renderers. */
  broadcastUpdateState: () => void
  /** Open the desktop settings window on the updates section. */
  showDesktopSettingsWindow: (section: 'updates') => void
  /** Shut the desktop shell down, then run the given action (install). */
  shutdown: (exit: () => void) => Promise<void>
  /** Fire-and-forget task runner funnelling rejections to the error reporter. */
  runTask: (task: Promise<unknown>) => void
}

type DesktopUpdateInteraction = 'interactive' | 'background' | 'settings'

export function createUpdateService(deps: UpdateDeps) {
  const { update, notifications } = deps

  /** Preferences file for desktop update policy. */
  function updatePreferencesPath(): string {
    return join(app.getPath('userData'), 'desktop-update-settings.json')
  }

  function setDesktopUpdateStatus(status: DesktopUpdateStatus, checked = false): void {
    update.status = status
    if (checked) update.lastUpdateCheckAt = new Date().toISOString()
    deps.refreshTrayMenu()
    deps.broadcastUpdateState()
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
      setDesktopUpdateStatus({ kind: 'error', message: publicDesktopUpdateError(error, deps.locale()) })
    })
  }

  function scheduleStartupUpdateCheck(): void {
    if (update.startupUpdateTimer !== undefined || !shouldCheckForUpdatesOnStartup(update.preferences, app.isPackaged)) return
    update.startupUpdateTimer = setTimeout(() => {
      update.startupUpdateTimer = undefined
      if (!deps.isQuitting() && shouldCheckForUpdatesOnStartup(update.preferences, app.isPackaged)) {
        deps.runTask(checkDesktopUpdate('background'))
      }
    }, STARTUP_UPDATE_CHECK_DELAY_MS)
  }

  async function checkDesktopUpdate(interaction: DesktopUpdateInteraction = 'interactive'): Promise<void> {
    if (update.status.kind === 'checking' || update.status.kind === 'downloading') return
    if (!app.isPackaged) {
      if (interaction === 'interactive') {
        await dialog.showMessageBox({
          type: 'info',
          title: DESKTOP_APP_NAME,
          message: deps.text('开发态不能检查安装包更新，请使用发布的安装包。', 'Update checks are unavailable in development builds. Use a released installer.'),
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
            message: deps.text('当前已是最新桌面端版本。', 'You already have the latest desktop version.'),
          })
        }
        return
      }
      const available: Extract<DesktopUpdateStatus, { kind: 'available' }> = { kind: 'available', version, releaseNotes: formatDesktopReleaseNotes(result?.updateInfo.releaseNotes) }
      setDesktopUpdateStatus(available, true)
      if (interaction === 'background') {
        if (shouldDownloadUpdateAutomatically(update.preferences)) await downloadDesktopUpdate('background')
        else showDesktopUpdateNotification('available', version)
        return
      }
      if (interaction === 'settings') return
      const prompt = await dialog.showMessageBox({
        type: 'question',
        title: DESKTOP_APP_NAME,
        message: desktopUpdatePrompt(available, deps.locale()),
        buttons: [deps.text('下载并安装', 'Download and Install'), deps.text('取消', 'Cancel')],
        defaultId: 0,
        cancelId: 1,
      })
      if (prompt.response === 0) await downloadDesktopUpdate('interactive')
    } catch (error) {
      const message = publicDesktopUpdateError(error, deps.locale())
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
    if (update.status.kind !== 'available') return
    const version = update.status.version
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
        message: desktopUpdatePrompt(ready, deps.locale()),
        buttons: [deps.text('现在安装', 'Install Now'), deps.text('稍后', 'Later')],
        defaultId: 0,
        cancelId: 1,
      })
      if (prompt.response === 0) await installDesktopUpdate()
    } catch (error) {
      const message = publicDesktopUpdateError(error, deps.locale())
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

  function dismissDesktopUpdateNotification(): void {
    notifications.active.get(DESKTOP_UPDATE_NOTIFICATION_ID)?.close()
    notifications.active.delete(DESKTOP_UPDATE_NOTIFICATION_ID)
  }

  function showDesktopUpdateNotification(kind: 'available' | 'ready', version: string): void {
    if (!Notification.isSupported()) return
    dismissDesktopUpdateNotification()
    const icon = resolveNotificationIconPath({ appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath: process.resourcesPath })
    const notification = new Notification({
      title: DESKTOP_APP_NAME,
      body: kind === 'ready'
        ? deps.text(`桌面端 ${version} 已下载，点击选择安装时间。`, `Desktop ${version} is ready. Click to choose when to install.`)
        : deps.text(`发现桌面端 ${version}，点击查看更新。`, `Desktop ${version} is available. Click to review the update.`),
      ...(icon === undefined ? {} : { icon }),
    })
    notifications.active.set(DESKTOP_UPDATE_NOTIFICATION_ID, notification)
    notification.on('click', () => {
      deps.showDesktopSettingsWindow('updates')
      dismissDesktopUpdateNotification()
    })
    notification.on('close', () => {
      if (notifications.active.get(DESKTOP_UPDATE_NOTIFICATION_ID) === notification) notifications.active.delete(DESKTOP_UPDATE_NOTIFICATION_ID)
    })
    notification.show()
  }

  async function installDesktopUpdate(): Promise<void> {
    await deps.shutdown(() => { autoUpdater.quitAndInstall(false, true) })
  }

  /** Renderer-safe snapshot of the current update state. */
  function desktopUpdateSnapshot(): DesktopUpdateSnapshot {
    return {
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      status: update.status,
      ...(update.lastUpdateCheckAt === undefined ? {} : { lastCheckedAt: update.lastUpdateCheckAt }),
    }
  }

  return {
    updatePreferencesPath,
    setDesktopUpdateStatus,
    configureDesktopUpdater,
    scheduleStartupUpdateCheck,
    checkDesktopUpdate,
    downloadDesktopUpdate,
    handleDesktopUpdateSettingsAction,
    dismissDesktopUpdateNotification,
    showDesktopUpdateNotification,
    installDesktopUpdate,
    desktopUpdateSnapshot,
  }
}

export type UpdateService = ReturnType<typeof createUpdateService>

/** Shape pushed to shell renderers. */
export interface DesktopUpdateSnapshot {
  readonly currentVersion: string
  readonly packaged: boolean
  readonly status: DesktopUpdateStatus
  readonly lastCheckedAt?: string
}
