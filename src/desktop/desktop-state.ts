/**
 * Explicit mutable-state store for the Electron main process.
 *
 * WHY THIS EXISTS
 * ---------------
 * `main.ts` used to hold 39 module-level `let` bindings shared implicitly by 111
 * functions. That made the full set of mutable state invisible — you had to grep
 * `^let` to find it — and made every function's real dependencies unknowable from
 * its signature. This module makes both explicit.
 *
 * MUTABILITY IS THE POINT — NOT WIDTH
 * -----------------------------------
 * The fields here are deliberately plain mutable properties, NOT getters and NOT
 * values captured at construction. The original code only worked because
 * module-level `let` is LATE-BOUND: IPC handlers are registered at startup, but the
 * windows they dereference are created later, and they read the binding when the
 * event fires.
 *
 * So this is correct:
 *
 *     ctx.windows.mainWindow = createWindow()      // same object, read later
 *
 * and this is a silent-failure bug:
 *
 *     installShellIpc(ctx.windows.mainWindow)      // captures undefined forever
 *
 * The wrong form passes type checking (`BrowserWindow | undefined` widens fine) and
 * fails only at runtime, with every handler quietly doing nothing. `??=` is also
 * used on `mainWindow`, which requires a writable property rather than a getter.
 *
 * NARROW CONSUMER SIGNATURES
 * --------------------------
 * Modules should declare only the slice they actually use (via `Pick<>` or a
 * hand-written narrow interface) rather than taking the whole store. The runtime
 * object is singular, but the signatures stay honest: `openDshTerminal` needs one
 * field, not thirty-nine. Structural typing makes this free.
 *
 * WHAT DOES NOT BELONG HERE
 * -------------------------
 * Collaborators and constants are not state:
 *   - the window-navigation coordinator (a class instance, mutated in place)
 *   - the shell action-id set (derived read-only from SHELL_ACTIONS)
 *   - the lazily imported DSH process module (a process-boundary dependency)
 */
import type { BrowserWindow, WebContentsView, Tray } from 'electron'

import type { DshServer, StartDshOptions } from '../bridge/dsh-process.js'
import type { DshNavigationState } from './shell-contract.js'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type DesktopNotificationPreferences,
} from '../desktop/desktop-notifications.js'
import {
  DEFAULT_UPDATE_PREFERENCES,
  type DesktopUpdatePreferences,
  type DesktopUpdateStatus,
} from '../desktop/desktop-updater.js'
import type { DesktopColorScheme, DesktopThemePreference } from '../desktop/desktop-theme.js'
import type { StartupDiagnosticStage } from '../recovery/startup-diagnostics.js'
import type { applyPendingProfileUpdates } from '../profiles/plugin-seed.js'

/** The subset of Electron's Notification the store tracks. */
type NativeNotification = Electron.Notification

/** Launch options retained so a restart can relaunch the same way. */
export type RetainedStartOptions = Omit<StartDshOptions, 'onUnexpectedExit' | 'onIpcMessage'>

/** Seed options retained so plugin updates can be applied without re-resolving paths. */
export type RetainedSeedOptions = Parameters<typeof applyPendingProfileUpdates>[0]

/** Top-level windows and content views. */
export interface WindowsState {
  mainWindow: BrowserWindow | undefined
  dshView: WebContentsView | undefined
  recoveryView: WebContentsView | undefined
  shortcutsWindow: BrowserWindow | undefined
  aboutWindow: BrowserWindow | undefined
  settingsWindow: BrowserWindow | undefined
}

/** DSH child-process handle and process-level lifecycle flags. */
export interface RuntimeState {
  server: DshServer | undefined
  tray: Tray | undefined
  isQuitting: boolean
  isRecycling: boolean
  runtimeExtractionAbortController: AbortController | undefined
  runtimeExtractionTask: Promise<void> | undefined
}

/** Everything needed to relaunch DSH, plus the recycle bookkeeping around it. */
export interface LaunchState {
  lastStartOptions: RetainedStartOptions | undefined
  lastSeedOptions: RetainedSeedOptions | undefined
  profileWatcher: { stop: () => void, sync: () => void } | undefined
  profileActivationRecyclePending: boolean
  profileActivationRecycleTask: Promise<void> | undefined
  profileActivationRecycleGeneration: number
  isReportingUnexpectedError: boolean
}

/** Auto-updater state. `preferences` is loaded BEFORE IPC handlers are installed. */
export interface UpdateState {
  status: DesktopUpdateStatus
  preferences: DesktopUpdatePreferences
  lastUpdateCheckAt: string | undefined
  startupUpdateTimer: NodeJS.Timeout | undefined
}

/** Shell chrome: navigation, origin guard, locale/theme, dialog visibility. */
export interface ShellState {
  navigationState: DshNavigationState
  allowedOrigin: string
  settingsDialogVisible: boolean
  locale: 'zh' | 'en' | undefined
  colorScheme: DesktopColorScheme
  themePreference: DesktopThemePreference
}

/** Native notification state. `preferences` is loaded BEFORE IPC handlers are installed. */
export interface NotificationState {
  preferences: DesktopNotificationPreferences
  active: Map<string, NativeNotification>
  unreadCompletionCount: number
}

/** Recovery-mode state. */
export interface RecoveryState {
  profileDir: string | undefined
  failureMessage: string | undefined
  failurePlugin: string | undefined
  failurePlugins: string[]
  handlingRendererBootFailure: boolean
}

/** Startup diagnostics. */
export interface DiagnosticsState {
  stage: Exclude<StartupDiagnosticStage, 'healthy'>
  rendererHealthTimer: NodeJS.Timeout | undefined
}

/** Window icon cache. */
export interface ChromeState {
  cachedWindowIcon: Electron.NativeImage | undefined
}

/**
 * The single mutable store. Fields stay mutable for the lifetime of the process —
 * see "MUTABILITY IS THE POINT" above before making any of them readonly.
 */
export interface DesktopState {
  readonly windows: WindowsState
  readonly runtime: RuntimeState
  readonly launch: LaunchState
  readonly update: UpdateState
  readonly shell: ShellState
  readonly notifications: NotificationState
  readonly recovery: RecoveryState
  readonly diagnostics: DiagnosticsState
  readonly chrome: ChromeState
}

/**
 * Create the store.
 *
 * Must be called BEFORE `installShellIpc()` / `installRecoveryIpc()`, and the
 * notification/update preferences must already be loaded — those handlers read the
 * values at call time and would otherwise observe defaults.
 */
export function createDesktopState(options: {
  notificationPreferences: DesktopNotificationPreferences
  updatePreferences: DesktopUpdatePreferences
  /** Initial colour scheme, read from `nativeTheme` by the caller after app ready. */
  initialColorScheme: DesktopColorScheme
  /** Native notification constructor; injected so the store stays importable without Electron. */
  NotificationCtor?: new (options: { title: string, body?: string }) => NativeNotification
}): DesktopState {
  return {
    windows: {
      mainWindow: undefined,
      dshView: undefined,
      recoveryView: undefined,
      shortcutsWindow: undefined,
      aboutWindow: undefined,
      settingsWindow: undefined,
    },
    runtime: {
      server: undefined,
      tray: undefined,
      isQuitting: false,
      isRecycling: false,
      runtimeExtractionAbortController: undefined,
      runtimeExtractionTask: undefined,
    },
    launch: {
      lastStartOptions: undefined,
      lastSeedOptions: undefined,
      profileWatcher: undefined,
      profileActivationRecyclePending: false,
      profileActivationRecycleTask: undefined,
      profileActivationRecycleGeneration: 0,
      isReportingUnexpectedError: false,
    },
    update: {
      status: { kind: 'idle' },
      preferences: options.updatePreferences,
      lastUpdateCheckAt: undefined,
      startupUpdateTimer: undefined,
    },
    shell: {
      navigationState: { canBack: false, canForward: false, canNextChat: false, canPreviousChat: false },
      allowedOrigin: '',
      settingsDialogVisible: false,
      locale: undefined,
      // Injected by the caller (which reads it after `app.whenReady()`), so this
      // module stays importable without pulling in Electron at load time.
      colorScheme: options.initialColorScheme,
      themePreference: 'system',
    },
    notifications: {
      preferences: options.notificationPreferences,
      active: new Map<string, NativeNotification>(),
      unreadCompletionCount: 0,
    },
    recovery: {
      profileDir: undefined,
      failureMessage: undefined,
      failurePlugin: undefined,
      failurePlugins: [],
      handlingRendererBootFailure: false,
    },
    diagnostics: {
      stage: 'server-starting',
      rendererHealthTimer: undefined,
    },
    chrome: {
      cachedWindowIcon: undefined,
    },
  }
}
