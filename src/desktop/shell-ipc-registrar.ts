/**
 * Registration of every `dsh-shell:*` IPC channel.
 *
 * WHY THIS EXISTS
 * ---------------
 * This was one 136-line function holding 22 registrations spanning six unrelated
 * feature areas (top-bar actions, notification preferences, update preferences,
 * window control, DSH renderer reports, notification bridge events). That is why it
 * was the worst fan-out point in the original file: it touched 21 functions across
 * 7 clusters.
 *
 * The registrations are grouped here by AREA, each group as its own function, so a
 * reader can find "where does the update-action channel live" without scanning a
 * wall of handlers. `installShellIpc` is now just the list of groups.
 *
 * THE LATE-BINDING CONTRACT
 * -------------------------
 * Handlers dereference windows and services at EVENT time, never at registration
 * time. `ensureWindowsNotificationIdentity` and friends run before the first window
 * exists, and the handlers registered here must still work once it does. So every
 * dependency below is a callback, not a captured value — passing `state.windows.mainWindow`
 * into this module would freeze `undefined` into every handler. The
 * `desktop-state-late-binding` test guards that.
 */
import { ipcMain, type WebContents } from 'electron'

import { SHELL_IPC, type DshNavigationState, type ShellMenuPopupRequest, type ShellToolId, type ShellToolPopupId } from './shell-contract.js'
import {
  mayAccessDesktopUpdates,
  mayAccessNotificationPreferences,
  mayCloseDesktopSettings,
  mayGetShellBootstrap,
  mayInvokeShellAction,
  mayPopupShellMenu,
  mayReportDshBoot,
  mayReportDshLocale,
  mayReportDshNotification,
  mayReportDshSettingsVisibility,
  mayReportDshState,
  mayReportDshTheme,
  type ShellRendererKind,
} from './shell-ipc-policy.js'
import { isChineseLocale, normalizeShellLocale, SHELL_ACTIONS, type ShellActionId } from './shell-actions.js'
import { normalizeDesktopThemeSnapshot, type DesktopColorScheme, type DesktopThemePreference } from './desktop-theme.js'
import { parseDesktopNotificationBridgeEvent } from './desktop-notifications.js'
import type { DesktopUpdateAction } from './desktop-updater.js'
import type { DesktopState } from './desktop-state.js'

/** Action ids accepted from the renderer; validated before dispatch. */
const shellActionIds: ReadonlySet<string> = new Set(SHELL_ACTIONS.map(action => action.id))

export interface ShellIpcDeps {
  /** Store slice read by the renderer-report handlers. */
  state: DesktopState
  /** Which window a message came from (guards every handler). */
  rendererKind: (sender: WebContents) => ShellRendererKind
  /** Full shell bootstrap payload. */
  bootstrap: () => unknown
  /** Push shell state to all shell renderers. */
  broadcastShellState: () => void
  /** Push a fresh bootstrap to all shell renderers. */
  broadcastShellBootstrap: () => void
  /** Run a top-bar action by id. */
  executeShellAction: (id: ShellActionId) => Promise<void>
  /** Run a tool (currently terminal) triggered from the top bar. */
  runShellTool: (tool: ShellToolId) => Promise<void> | undefined
  /** Open a tool's popup menu at window coordinates. */
  popupShellTool: (tool: ShellToolPopupId, x: number, y: number) => Promise<void>
  /** Open the top-bar's own context menu. */
  popupShellMenu: (request: ShellMenuPopupRequest) => Promise<void>
  /** Persist notification preferences, returning the stored value. */
  saveNotificationPreferences: (value: unknown) => Promise<unknown>
  /** Persist update preferences, returning the stored value. */
  saveUpdatePreferences: (value: unknown) => Promise<unknown>
  /** Snapshot of the current update state for the settings window. */
  updateSnapshot: () => unknown
  /** Drive check / download / install from the settings window. */
  handleUpdateAction: (action: DesktopUpdateAction) => Promise<void>
  /** Apply a theme snapshot reported by the DSH renderer. */
  applyTheme: (colorScheme: DesktopColorScheme, preference?: DesktopThemePreference) => void
  /** Handle the DSH renderer's structured boot report. */
  reportRendererBoot: (value: unknown) => Promise<unknown>
  /** Re-render the unread badge after a locale change. */
  updateUnreadBadge: (count: number) => void
  /** Handle a validated notification bridge event. */
  handleBridgeNotification: (payload: unknown) => void
  /** Fire-and-forget task runner funnelling rejections to the error reporter. */
  runTask: (task: Promise<unknown>) => void
}

export function createShellIpcRegistrar(deps: ShellIpcDeps) {
  const { state } = deps

  /** Top-bar actions and the bootstrap payload the shell renderers ask for. */
  function installShellActionIpc(): void {
    ipcMain.removeHandler(SHELL_IPC.getBootstrap)
    ipcMain.removeHandler(SHELL_IPC.action)
    ipcMain.removeHandler(SHELL_IPC.tool)
    ipcMain.removeHandler(SHELL_IPC.popupTool)
    ipcMain.removeHandler(SHELL_IPC.popupMenu)
    ipcMain.handle(SHELL_IPC.getBootstrap, event => {
      if (!mayGetShellBootstrap(deps.rendererKind(event.sender))) return
      return deps.bootstrap()
    })
    ipcMain.handle(SHELL_IPC.action, (event, id: unknown) => {
      if (typeof id !== 'string' || !shellActionIds.has(id)) return
      const actionId = id as ShellActionId
      if (!mayInvokeShellAction(deps.rendererKind(event.sender), actionId)) return
      return deps.executeShellAction(actionId)
    })
    ipcMain.handle(SHELL_IPC.tool, (event, tool: unknown) => {
      if (!mayPopupShellMenu(deps.rendererKind(event.sender))) return
      if (tool !== 'terminal') return
      return deps.runShellTool('terminal')
    })
    ipcMain.handle(SHELL_IPC.popupTool, (event, tool: unknown, x: unknown, y: unknown) => {
      if (!mayPopupShellMenu(deps.rendererKind(event.sender))) return
      if (tool !== 'reload' && tool !== 'developer') return
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      return deps.popupShellTool(tool, Math.round(Number(x)), Math.round(Number(y)))
    })
    ipcMain.handle(SHELL_IPC.popupMenu, (event, request: ShellMenuPopupRequest) => {
      if (!mayPopupShellMenu(deps.rendererKind(event.sender))) return
      return deps.popupShellMenu(request)
    })
  }

  /** Notification preference read/write driven by the settings window. */
  function installNotificationPreferenceIpc(): void {
    ipcMain.removeHandler(SHELL_IPC.getNotificationPreferences)
    ipcMain.removeHandler(SHELL_IPC.updateNotificationPreferences)
    ipcMain.handle(SHELL_IPC.getNotificationPreferences, event => {
      if (!mayAccessNotificationPreferences(deps.rendererKind(event.sender))) return
      return state.notifications.preferences
    })
    ipcMain.handle(SHELL_IPC.updateNotificationPreferences, async (event, value: unknown) => {
      if (!mayAccessNotificationPreferences(deps.rendererKind(event.sender))) return
      state.notifications.preferences = await deps.saveNotificationPreferences(value) as typeof state.notifications.preferences
      return state.notifications.preferences
    })
  }

  /** Update preference / state / action channels driven by the settings window. */
  function installUpdateIpc(): void {
    ipcMain.removeHandler(SHELL_IPC.getUpdatePreferences)
    ipcMain.removeHandler(SHELL_IPC.updateUpdatePreferences)
    ipcMain.removeHandler(SHELL_IPC.getDesktopUpdateState)
    ipcMain.removeHandler(SHELL_IPC.desktopUpdateAction)
    ipcMain.handle(SHELL_IPC.getUpdatePreferences, event => {
      if (!mayAccessDesktopUpdates(deps.rendererKind(event.sender))) return
      return state.update.preferences
    })
    ipcMain.handle(SHELL_IPC.updateUpdatePreferences, async (event, value: unknown) => {
      if (!mayAccessDesktopUpdates(deps.rendererKind(event.sender))) return
      state.update.preferences = await deps.saveUpdatePreferences(value) as typeof state.update.preferences
      // Turning on auto-download while an update is already known should start it
      // immediately rather than waiting for the next check.
      if (state.update.preferences.policy === 'auto-download' && state.update.status.kind === 'available') {
        deps.runTask(deps.handleUpdateAction('download'))
      }
      return state.update.preferences
    })
    ipcMain.handle(SHELL_IPC.getDesktopUpdateState, event => {
      if (!mayAccessDesktopUpdates(deps.rendererKind(event.sender))) return
      return deps.updateSnapshot()
    })
    ipcMain.handle(SHELL_IPC.desktopUpdateAction, async (event, value: unknown) => {
      if (!mayAccessDesktopUpdates(deps.rendererKind(event.sender))) return
      if (value !== 'check' && value !== 'download' && value !== 'install') return
      await deps.handleUpdateAction(value)
      return deps.updateSnapshot()
    })
  }

  /** Closing the settings window (the renderer cannot close its own window). */
  function installWindowControlIpc(): void {
    ipcMain.removeHandler(SHELL_IPC.closeDesktopSettings)
    ipcMain.handle(SHELL_IPC.closeDesktopSettings, event => {
      if (!mayCloseDesktopSettings(deps.rendererKind(event.sender))) return
      state.windows.settingsWindow?.close()
    })
  }

  /**
   * Reports pushed UP from the DSH renderer (navigation, boot, locale, theme,
   * settings-dialog visibility). These are `on`, not `handle`: the renderer does
   * not wait for a reply.
   */
  function installDshReportIpc(): void {
    ipcMain.removeAllListeners(SHELL_IPC.dshState)
    ipcMain.on(SHELL_IPC.dshState, (event, navigation: Partial<DshNavigationState>) => {
      if (!mayReportDshState(deps.rendererKind(event.sender))) return
      if (typeof navigation !== 'object' || navigation === null) return
      state.shell.navigationState = {
        canBack: navigation.canBack === true,
        canForward: navigation.canForward === true,
        canNextChat: navigation.canNextChat === true,
        canPreviousChat: navigation.canPreviousChat === true,
      }
      deps.broadcastShellState()
    })
    ipcMain.removeAllListeners(SHELL_IPC.dshBoot)
    ipcMain.on(SHELL_IPC.dshBoot, (event, value: unknown) => {
      if (!mayReportDshBoot(deps.rendererKind(event.sender))) return
      deps.runTask(deps.reportRendererBoot(value))
    })
    ipcMain.removeAllListeners(SHELL_IPC.dshLocale)
    ipcMain.on(SHELL_IPC.dshLocale, (event, value: unknown) => {
      if (!mayReportDshLocale(deps.rendererKind(event.sender))) return
      const locale = normalizeShellLocale(value)
      if (locale === undefined || locale === state.shell.locale) return
      state.shell.locale = locale
      deps.broadcastShellBootstrap()
      deps.updateUnreadBadge(state.notifications.unreadCompletionCount)
    })
    ipcMain.removeAllListeners(SHELL_IPC.dshTheme)
    ipcMain.on(SHELL_IPC.dshTheme, (event, value: unknown) => {
      if (!mayReportDshTheme(deps.rendererKind(event.sender))) return
      const snapshot = normalizeDesktopThemeSnapshot(value)
      if (snapshot === undefined) return
      const colorSchemeChanged = snapshot.colorScheme !== state.shell.colorScheme
      const preferenceChanged = snapshot.preference !== undefined && snapshot.preference !== state.shell.themePreference
      if (!colorSchemeChanged && !preferenceChanged) return
      deps.applyTheme(snapshot.colorScheme, snapshot.preference)
      if (colorSchemeChanged) deps.broadcastShellBootstrap()
    })
    ipcMain.removeAllListeners(SHELL_IPC.dshSettingsVisibility)
    ipcMain.on(SHELL_IPC.dshSettingsVisibility, (event, value: unknown) => {
      if (!mayReportDshSettingsVisibility(deps.rendererKind(event.sender))) return
      state.shell.settingsDialogVisible = value === true
    })
  }

  /** Notification bridge events pushed up from the DSH renderer. */
  function installNotificationBridgeIpc(): void {
    ipcMain.removeAllListeners(SHELL_IPC.dshNotification)
    ipcMain.on(SHELL_IPC.dshNotification, (event, value: unknown) => {
      if (!mayReportDshNotification(deps.rendererKind(event.sender))) return
      const notificationEvent = parseDesktopNotificationBridgeEvent(value)
      if (notificationEvent === undefined) return
      deps.handleBridgeNotification(notificationEvent)
    })
  }

  /** Register every shell channel. Must run once per process. */
  function installShellIpc(): void {
    installShellActionIpc()
    installNotificationPreferenceIpc()
    installUpdateIpc()
    installWindowControlIpc()
    installDshReportIpc()
    installNotificationBridgeIpc()
  }

  return { installShellIpc }
}

export type ShellIpcRegistrar = ReturnType<typeof createShellIpcRegistrar>

/** Action ids accepted from the renderer; kept beside its only consumer. */

