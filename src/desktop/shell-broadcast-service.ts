/**
 * Theme application and shell-state broadcast.
 *
 * WHY THIS EXISTS
 * ---------------
 * These six functions are a cross-cutting concern: the top-bar IPC handlers, the
 * tray, the window registry, the dialog service and the settings page all call
 * into them. Leaving them in `main.ts` kept the widest fan-out point unresolved, so
 * extracting them was a prerequisite for the recovery split (ticket 13).
 *
 * THE REPEATED BROADCAST LOOP
 * ---------------------------
 * Both `broadcastShellState` and `broadcastShellBootstrap` walked the same list of
 * four shell windows (main / shortcuts / about / settings), skipping destroyed
 * ones, and pushed a payload to each. That list is now `shellWindows()` — one
 * place to add a window that should receive shell updates. The update-state
 * broadcast targets only the settings window, so it keeps its own narrower send.
 *
 * WHAT STATE IT NEEDS
 * -------------------
 * Read through accessors, at call time: the window handles (late-bound), the shell
 * slice (locale/theme/navigation) and the recycling flag. Nothing is captured at
 * construction.
 */
import { nativeTheme, type BrowserWindow } from 'electron'

import { DESKTOP_THEME_PALETTES, type DesktopColorScheme, type DesktopThemePreference } from './desktop-theme.js'
import { SHELL_BAR_HEIGHT, SHELL_IPC, type ShellBootstrap, type ShellState } from './shell-contract.js'
import { localizedShellActions, localizedShellMenus } from './shell-actions.js'
import { OFFICIAL_DSH_VERSION } from '../runtime/bundled-plugins.js'
import type { ShellState as ShellStoreState, WindowsState } from './desktop-state.js'

export interface ShellBroadcastDeps {
  windows: WindowsState
  shell: ShellStoreState
  /** Recycle flag, read at call time. */
  isRecycling: () => boolean
  /** Current app locale (resolved, not raw). */
  locale: () => string
  /** App version reported in the bootstrap payload. */
  appVersion: () => string
  /** Snapshot of update state, pushed to the settings window. */
  updateSnapshot: () => unknown
}

export function createShellBroadcastService(deps: ShellBroadcastDeps) {
  const { windows, shell } = deps

  /** Every window that receives shell state/bootstrap pushes. */
  function shellWindows(): Array<BrowserWindow | undefined> {
    return [windows.mainWindow, windows.shortcutsWindow, windows.aboutWindow, windows.settingsWindow]
  }

  /** Push a payload to every live shell window. */
  function sendToShellWindows(channel: string, payload: unknown): void {
    for (const window of shellWindows()) {
      if (window !== undefined && !window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }

  /** Zoom, fullscreen and navigation state the shell bar renders. */
  function currentShellState(): ShellState {
    const window = windows.mainWindow
    const zoomFactor = windows.dshView?.webContents.getZoomFactor() ?? 1
    return {
      ...shell.navigationState,
      fullscreen: window?.isFullScreen() ?? false,
      reloading: deps.isRecycling(),
      zoomPercent: Math.round(zoomFactor * 100),
    }
  }

  /** The full payload a shell renderer needs on load or after a theme change. */
  function shellBootstrap(): ShellBootstrap {
    const locale = deps.locale()
    const palette = DESKTOP_THEME_PALETTES[shell.colorScheme]
    return {
      actions: localizedShellActions(locale, process.platform),
      colorScheme: shell.colorScheme,
      locale,
      menus: localizedShellMenus(locale),
      platform: process.platform,
      runtimeVersion: OFFICIAL_DSH_VERSION,
      state: currentShellState(),
      version: deps.appVersion(),
      titleBar: { background: palette.titleBarBackground, symbol: palette.titleBarSymbol },
    }
  }

  function broadcastShellBootstrap(): void {
    sendToShellWindows(SHELL_IPC.bootstrap, shellBootstrap())
  }

  function broadcastShellState(): void {
    sendToShellWindows(SHELL_IPC.state, currentShellState())
  }

  /** Repaint a window's native background; a destroyed window is skipped. */
  function setWindowBackground(window: BrowserWindow | undefined, color: string): void {
    if (window !== undefined && !window.isDestroyed()) window.setBackgroundColor(color)
  }

  /**
   * Apply a colour scheme (and optionally persist the preference).
   *
   * Repaints every window's native background from the palette. The windows
   * themselves re-theme from the bootstrap broadcast; these native colors only
   * cover the frame area before the first paint, which is why they are set here
   * rather than in the renderer.
   *
   * There is deliberately NO `setTitleBarOverlay` call: the caption buttons are
   * renderer-drawn now (see `src/shell-ui/WindowControls.tsx`), so no native
   * overlay exists to repaint.
   */
  function applyDesktopTheme(colorScheme: DesktopColorScheme, preference?: DesktopThemePreference): void {
    shell.colorScheme = colorScheme
    if (preference !== undefined) {
      shell.themePreference = preference
      nativeTheme.themeSource = preference
    }
    const palette = DESKTOP_THEME_PALETTES[colorScheme]
    setWindowBackground(windows.mainWindow, palette.titleBarBackground)
    setWindowBackground(windows.settingsWindow, palette.settingsBackground)
    setWindowBackground(windows.shortcutsWindow, palette.shortcutsBackground)
    setWindowBackground(windows.aboutWindow, palette.aboutBackground)
  }

  /** Push the update snapshot to the settings window only. */
  function broadcastDesktopUpdateState(): void {
    const window = windows.settingsWindow
    if (window !== undefined && !window.isDestroyed()) {
      window.webContents.send(SHELL_IPC.desktopUpdateState, deps.updateSnapshot())
    }
  }

  return {
    currentShellState,
    shellBootstrap,
    broadcastShellBootstrap,
    broadcastShellState,
    setWindowBackground,
    applyDesktopTheme,
    broadcastDesktopUpdateState,
  }
}

export type ShellBroadcastService = ReturnType<typeof createShellBroadcastService>
