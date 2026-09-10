/**
 * Explicit mutable-state store for the Electron main process.
 *
 * WHY THIS EXISTS
 * ---------------
 * `main.ts` used to hold 39 module-level `let` bindings shared implicitly by 111
 * functions. The full set of mutable state was invisible — you had to grep `^let`
 * to find it — and scattered across the file in no particular order.
 *
 * This module gives that state ONE declared home, grouped by sub-domain, so the
 * complete inventory is readable in one place.
 *
 * WHAT THIS DOES NOT (YET) DO
 * ---------------------------
 * Consolidating 39 bindings into one store does NOT make per-function dependencies
 * explicit. `main.ts` still keeps a single module-level `let state`, and the
 * functions still read it ambiently — so from a signature you still cannot tell
 * what a function touches. Narrowing those signatures (`Pick<...>` / hand-written
 * deps interfaces) only becomes possible once the functions move into their own
 * modules, which is the work of the later extraction tickets. Until then, treat
 * this module as a readable inventory, not as a dependency-declaration mechanism.
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
 *     state.windows.mainWindow = createWindow()     // same object, read later
 *
 * and this is a silent-failure bug:
 *
 *     installShellIpc(state.windows.mainWindow)     // captures undefined forever
 *
 * The wrong form passes type checking (`BrowserWindow | undefined` widens fine) and
 * fails only at runtime, with every handler quietly doing nothing. `??=` is also
 * used on `mainWindow`, which requires a writable property rather than a getter.
 * This hazard is live as soon as a consumer receives a slice by value — which is
 * exactly what the extraction tickets will introduce, so the rule matters then even
 * though no consumer takes a slice today.
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
