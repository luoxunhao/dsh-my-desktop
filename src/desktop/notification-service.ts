/**
 * Native notification ownership: preferences, the live notification set, unread
 * badge, and the reply path back into DSH.
 *
 * WHY THIS EXISTS
 * ---------------
 * These functions were spread across `main.ts` and shared the module-level
 * `activeNotifications` map with the updater. That map is the reason notifications
 * and updater are extracted together: the updater looks up and dismisses ITS
 * notification by id through the same set.
 *
 * CYCLES BROKEN BY INJECTION, NOT BY AN EVENT BUS
 * -----------------------------------------------
 * The tray and the updater call each other:
 *   - updater  → tray      (`setDesktopUpdateStatus` refreshes the tray menu)
 *   - tray     → updater   (menu items run check / download / install)
 * and notifications reach back into the shell (badge on the main window) and into
 * the updater's notification. A plain `import` between those modules would be a
 * cycle. Each such edge therefore arrives as an injected callback.
 *
 * The decision to use explicit callbacks rather than an event bus is recorded in
 * the ADR: a bus hides the dependency in a runtime string, which makes the call
 * chain untraceable and turns a typo into a silent no-op. Injection keeps every
 * edge visible at the composition root.
 */
import { app, Notification, nativeImage, shell } from 'electron'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { DESKTOP_APP_NAME, DESKTOP_APP_USER_MODEL_ID, DESKTOP_TOAST_ACTIVATOR_CLSID } from '../app/app-identity.js'
import { resolveNotificationIconPath, resolveTaskBadgeIconPath } from '../app/app-icon.js'
import { isChineseLocale } from './shell-actions.js'
import { SHELL_IPC } from './shell-contract.js'
import {
  buildWindowsReplyToastXml,
  parseWindowsNotificationReplyActivation,
  shouldShowDesktopNotification,
  windowsNotificationReplyArguments,
  type DesktopNotificationEvent,
  type DesktopNotificationPreferences,
} from './desktop-notifications.js'
import type { NotificationState, WindowsState } from './desktop-state.js'

/** The store slice this module owns and reads. */
export interface NotificationDeps {
  windows: WindowsState
  notifications: NotificationState
  /** Current shell locale, used to pick zh/en copy. */
  locale: () => string
  /** Refresh the tray menu after the unread badge changes. */
  refreshTrayMenu: () => void
  /** Restore and focus the main window (notification click). */
  showMainWindow: () => void
  /** Open the desktop settings window on a section (update notification click). */
  showDesktopSettingsWindow: (section: 'updates') => void
  /** Fire-and-forget task runner funnelling rejections to the error reporter. */
  runTask: (task: Promise<unknown>) => void
}

export function createNotificationService(deps: NotificationDeps) {
  const { windows: w, notifications } = deps

  /** Preferences file for desktop notifications. */
  function notificationPreferencesPath(): string {
    return join(app.getPath('userData'), 'desktop-settings.json')
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
    if (w.dshView === undefined || w.dshView.webContents.isDestroyed()) {
      showNotificationReplyError(sessionId)
      return
    }
    w.dshView.webContents.send(SHELL_IPC.dshNotificationReply, { sessionId, text })
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
    const zh = isChineseLocale(deps.locale())
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
    notifications.unreadCompletionCount = count
    if (process.platform === 'win32' && w.mainWindow !== undefined && !w.mainWindow.isDestroyed()) {
      if (count === 0) {
        w.mainWindow.setOverlayIcon(null, '')
      } else {
        const iconPath = resolveTaskBadgeIconPath({ appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath: process.resourcesPath }, count)
        const overlay = nativeImage.createFromPath(iconPath)
        if (!overlay.isEmpty()) {
          const description = isChineseLocale(deps.locale()) ? `${count} 个已完成任务` : `${count} completed tasks`
          w.mainWindow.setOverlayIcon(overlay, description)
        }
      }
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      app.setBadgeCount(count)
    }
    deps.refreshTrayMenu()
  }

  function dismissNotificationsForSession(sessionId: string): void {
    for (const [id, notification] of notifications.active) {
      if (!id.endsWith(`:${sessionId}`)) continue
      notification.close()
      notifications.active.delete(id)
    }
  }

  function focusMainWindowForNotification(): void {
    deps.showMainWindow()
    if (process.platform !== 'win32' || w.mainWindow === undefined) return
    w.mainWindow.setAlwaysOnTop(true)
    w.mainWindow.focus()
    w.mainWindow.setAlwaysOnTop(false)
  }

  function openNotificationSession(sessionId: string): void {
    focusMainWindowForNotification()
    if (w.dshView !== undefined && !w.dshView.webContents.isDestroyed()) {
      w.dshView.webContents.send(SHELL_IPC.dshOpenSession, sessionId)
    }
  }

  function showNotificationReplyError(sessionId: string): void {
    if (!Notification.isSupported()) return
    const zh = isChineseLocale(deps.locale())
    const id = `reply-error:${sessionId}`
    notifications.active.get(id)?.close()
    const notification = new Notification({
      title: zh ? '回复发送失败' : 'Reply not sent',
      body: zh ? '未能将回复发送到这个任务。请打开任务后重试。' : 'The reply could not be sent to this task. Open it and try again.',
      timeoutType: 'never',
    })
    notifications.active.set(id, notification)
    notification.on('click', () => {
      openNotificationSession(sessionId)
      dismissNotificationsForSession(sessionId)
    })
    notification.on('close', () => {
      if (notifications.active.get(id) === notification) notifications.active.delete(id)
    })
    notification.show()
  }

  function showDesktopNotification(event: DesktopNotificationEvent): void {
    if (!Notification.isSupported()) return
    if (!shouldShowDesktopNotification(event, notifications.preferences, w.mainWindow?.isFocused() ?? false)) return
    const id = `${event.kind}:${event.sessionId}`
    notifications.active.get(id)?.close()
    const copy = notificationCopy(event)
    const supportsReply = event.kind !== 'approval' && (process.platform === 'win32' || process.platform === 'darwin')
    const zh = isChineseLocale(deps.locale())
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
    notifications.active.set(id, notification)
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
      if (notifications.active.get(id) === notification) notifications.active.delete(id)
    })
    notification.show()
  }

  return {
    notificationPreferencesPath,
    ensureWindowsNotificationIdentity,
    sendNotificationReplyToDsh,
    installWindowsNotificationActivationHandler,
    notificationCopy,
    updateUnreadCompletionBadge,
    dismissNotificationsForSession,
    focusMainWindowForNotification,
    openNotificationSession,
    showNotificationReplyError,
    showDesktopNotification,
  }
}

export type NotificationService = ReturnType<typeof createNotificationService>
