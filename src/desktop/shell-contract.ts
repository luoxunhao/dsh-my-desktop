import type { LocalizedShellAction, LocalizedShellMenu, ShellActionId, ShellMenuId } from './shell-actions.js'

export const SHELL_BAR_HEIGHT = 40

export const SHELL_IPC = {
  action: 'dsh-shell:action',
  tool: 'dsh-shell:tool',
  popupTool: 'dsh-shell:popup-tool',
  getBootstrap: 'dsh-shell:get-bootstrap',
  popupMenu: 'dsh-shell:popup-menu',
  windowControl: 'dsh-shell:window-control',
  windowState: 'dsh-shell:window-state',
  state: 'dsh-shell:state',
  bootstrap: 'dsh-shell:bootstrap',
  dshAction: 'dsh-shell:dsh-action',
  dshBoot: 'dsh-shell:dsh-boot',
  dshLocale: 'dsh-shell:dsh-locale',
  dshTheme: 'dsh-shell:dsh-theme',
  dshSettingsVisibility: 'dsh-shell:dsh-settings-visibility',
  dshOpenSession: 'dsh-shell:dsh-open-session',
  dshNotificationReply: 'dsh-shell:dsh-notification-reply',
  dshState: 'dsh-shell:dsh-state',
  dshNotification: 'dsh-shell:dsh-notification',
  getNotificationPreferences: 'dsh-shell:get-notification-preferences',
  updateNotificationPreferences: 'dsh-shell:update-notification-preferences',
  getUpdatePreferences: 'dsh-shell:get-update-preferences',
  updateUpdatePreferences: 'dsh-shell:update-update-preferences',
  getDesktopUpdateState: 'dsh-shell:get-desktop-update-state',
  desktopUpdateAction: 'dsh-shell:desktop-update-action',
  desktopUpdateState: 'dsh-shell:desktop-update-state',
  settingsSection: 'dsh-shell:settings-section',
  closeDesktopSettings: 'dsh-shell:close-desktop-settings',
} as const

export interface DshNavigationState {
  readonly canBack: boolean
  readonly canForward: boolean
  readonly canNextChat: boolean
  readonly canPreviousChat: boolean
}

export interface ShellState extends DshNavigationState {
  readonly fullscreen: boolean
  readonly reloading: boolean
  readonly zoomPercent: number
}

export interface ShellBootstrap {
  readonly actions: readonly LocalizedShellAction[]
  readonly colorScheme: 'light' | 'dark'
  readonly locale: string
  readonly menus: readonly LocalizedShellMenu[]
  readonly platform: NodeJS.Platform
  readonly runtimeVersion: string
  readonly state: ShellState
  readonly version: string
  /**
   * Title-bar colors owned by the main process.
   *
   * The caption buttons are renderer-drawn, so the renderer needs the same
   * values the main process uses for the window's native background. Shipping
   * them through the bootstrap is what makes "one color authority" true in
   * practice rather than only in intent: the renderer never hard-codes a
   * caption color, so the two can no longer drift.
   */
  readonly titleBar: ShellTitleBarPalette
}

export interface ShellTitleBarPalette {
  /** Native window background; matches the bar's right-hand gradient stop. */
  readonly background: string
  /** Caption-glyph color; identical for the toolbar icons beside it. */
  readonly symbol: string
}

export interface ShellMenuPopupRequest {
  readonly menu: ShellMenuId
  /** X coordinate in the shell renderer's content viewport. */
  readonly x: number
  /** Y coordinate in the shell renderer's content viewport. */
  readonly y: number
}

export type DshShellActionId = Extract<ShellActionId,
  'new-chat' | 'open-folder' | 'settings' | 'toggle-sidebar' | 'find' |
  'previous-chat' | 'next-chat' | 'back' | 'forward'>

/** Title-bar tool actions surfaced by the Desktop frame (reference-aligned). */
export type ShellToolId = 'terminal' | 'reload' | 'developer'

/** Native popup shown for a popup-capable title-bar tool. */
export type ShellToolPopupId = 'reload' | 'developer'

/**
 * Caption-button commands issued by a self-drawn title bar.
 *
 * These exist because the launcher draws its own minimise/maximise/close
 * buttons instead of letting Electron paint them (see `frontend/shell/WindowControls.tsx`
 * for why: the native overlay cannot follow the bar's gradient, which produced a
 * visible color seam against the renderer-drawn icons beside it).
 *
 * `close` is NOT `ShellActionId: 'close-window'`, which hides the main window to
 * the tray. These three act on the window that issued them, and are the only
 * way a renderer can reach window chrome.
 */
export type ShellWindowCommand = 'minimize' | 'toggle-maximize' | 'close'

export interface ShellWindowState {
  readonly maximized: boolean
}
