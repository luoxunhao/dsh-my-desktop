/**
 * Tray icon and its context menu.
 *
 * THE CYCLE THIS MODULE SITS IN
 * -----------------------------
 * The tray was one half of the tightest cycle in the original file. It reads update
 * state to build its menu (`buildDesktopTrayItems({ status })`) and its menu items
 * drive the updater back:
 *
 *   tray → updater   check / download / install
 *   updater → tray   `setDesktopUpdateStatus` refreshes this menu
 *
 * Both directions are injected callbacks here, so no module imports the other in a
 * loop. The tray also reaches the shell (`showMainWindow`), the DSH lifecycle
 * (`recycleDshForPluginUpdate`) and app shutdown (`requestQuit`) — six edges in
 * total, all explicit in `TrayDeps` rather than ambient module state.
 *
 * That fan-out is why the tray is the LAST of the three to be extracted: it needs
 * the other two to exist before its own dependencies can be spelled out.
 */
import { app, Menu, Tray, nativeImage } from 'electron'

import { DESKTOP_APP_NAME } from '../app/app-identity.js'
import { resolveCompactIconCrop, resolveRasterIconPath, TRAY_ICON_SIZE } from '../app/app-icon.js'
import { isChineseLocale } from './shell-actions.js'
import { buildDesktopTrayItems, type DesktopUpdateStatus } from './desktop-updater.js'
import type { NotificationState, UpdateState } from './desktop-state.js'

export interface TrayDeps {
  /** Live tray handle slot; `undefined` means not created yet. */
  tray: { current: Tray | undefined }
  update: UpdateState
  notifications: NotificationState
  /** Current shell locale, used for tooltip and menu copy. */
  locale: () => string
  /** Restore and focus the main window (`show` item, tray click). */
  showMainWindow: () => void
  /** Recycle DSH after plugin changes (`reload` item). */
  reloadDsh: () => Promise<void>
  /** Quit the desktop app (`quit` item). */
  requestQuit: () => Promise<void>
  /** Update actions driven from the menu. */
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  /** Fire-and-forget task runner funnelling rejections to the error reporter. */
  runTask: (task: Promise<unknown>) => void
}

/** Current update status, read at menu-build time so the menu never goes stale. */
export function createTrayService(deps: TrayDeps) {
  const { tray, update, notifications } = deps

  function createTray(): void {
    if (tray.current !== undefined) {
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
      tray.current = new Tray(icon)
    } catch {
      return
    }
    tray.current.on('click', () => deps.showMainWindow())
    refreshTrayMenu()
  }

  function refreshTrayMenu(): void {
    if (tray.current === undefined) return
    const badgeSuffix = notifications.unreadCompletionCount > 0
      ? (isChineseLocale(deps.locale()) ? ` · ${notifications.unreadCompletionCount} 个已完成任务` : ` · ${notifications.unreadCompletionCount} completed tasks`)
      : ''
    tray.current.setToolTip(DESKTOP_APP_NAME + badgeSuffix)
    const items = buildDesktopTrayItems({
      status: update.status,
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      locale: deps.locale(),
    })
    tray.current.setContextMenu(Menu.buildFromTemplate(items.map(item => {
      if (item.type === 'separator') return { type: 'separator' }
      return {
        label: item.label,
        enabled: item.enabled,
        click: () => { deps.runTask(handleTrayUpdateAction(item.id)) },
      }
    })))
  }

  async function handleTrayUpdateAction(id: string): Promise<void> {
    if (id === 'show') {
      deps.showMainWindow()
      return
    }
    if (id === 'reload') {
      await deps.reloadDsh()
      return
    }
    if (id === 'quit') {
      await deps.requestQuit()
      return
    }
    if (id === 'check') {
      await deps.checkForUpdates()
      return
    }
    if (id === 'download') {
      await deps.downloadUpdate()
      return
    }
    if (id === 'install') {
      await deps.installUpdate()
    }
  }

  return {
    createTray,
    refreshTrayMenu,
    handleTrayUpdateAction,
  }
}

export type TrayService = ReturnType<typeof createTrayService>

/** Re-exported so the composition root can type the tray slot without a second import. */
export type { DesktopUpdateStatus }
