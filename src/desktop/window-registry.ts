/**
 * Ownership of the top-level windows and content views.
 *
 * WHY THIS EXISTS
 * ---------------
 * The main-window handle was read by 43 call sites spanning 8 unrelated feature
 * clusters, and window creation itself touched 7 unrelated concerns at once
 * (theme colours, preload resolution, navigation guards, shortcut handling,
 * persisted window state, shell-state broadcast, recovery bookkeeping). Nothing
 * else could be extracted while "who owns the windows" had no answer.
 *
 * This module is that answer: it owns the handles, their creation, layout, and
 * view visibility. Everything it needs from other areas arrives as an explicit
 * dependency, so its coupling is readable from the signature instead of being
 * smeared across main.ts.
 *
 * LATE BINDING — READ BEFORE CHANGING
 * -----------------------------------
 * The handles live on the mutable store and are assigned through `??=`. IPC
 * handlers are registered BEFORE the first window exists and dereference the
 * handle when an event fires. That is why this module exposes accessor functions
 * rather than returning handles at construction: handing out a value would freeze
 * `undefined` into every consumer.
 */
import { BrowserWindow, WebContentsView, shell } from 'electron'

import { SHELL_BAR_HEIGHT } from './shell-contract.js'
import { DESKTOP_THEME_PALETTES } from './desktop-theme.js'
import { DESKTOP_APP_NAME } from '../app/app-identity.js'
import { shouldHideInsteadOfClose } from '../app/app-lifecycle.js'
import { applyInitialWindowState } from './window-state.js'
import { isExternalOpenUrl, isSameOrigin } from '../infra/navigation.js'
import type { DesktopState } from './desktop-state.js'

/** Everything `createWindow` needs from the rest of the app. */
export interface WindowRegistryDeps {
  /** The mutable store holding every handle. */
  state: DesktopState
  /** Resolve a preload script's compiled path. */
  resolvePreload: (name: 'shell-preload.cjs' | 'dsh-view-preload.cjs' | 'recovery-preload.cjs') => string
  /** Resolve a shell asset (title bar, shortcuts, about, settings HTML). */
  resolveShellAsset: (name: 'shell.html' | 'shortcuts.html' | 'about.html' | 'settings.html') => string
  /** Window icon, or undefined when none is available. */
  resolveWindowIconImage: () => Electron.NativeImage | undefined
  /** Navigation coordinator guarding in-app history moves. */
  isNavigating: () => boolean
  /** Attach the top-bar keyboard shortcut handler to a web contents. */
  installShortcutHandler: (contents: Electron.WebContents) => void
  /** Fire-and-forget task runner that funnels rejections to the error reporter. */
  runTask: (task: Promise<unknown>) => void
  /** Push shell state to every shell renderer (fullscreen / reload transitions). */
  broadcastShellState: () => void
}

/**
 * Create the window registry bound to one store.
 *
 * The returned functions are the only supported way to reach the handles.
 */
export function createWindowRegistry(deps: WindowRegistryDeps) {
  const { state } = deps

  function requireDshView(): WebContentsView {
    if (state.windows.dshView === undefined) throw new Error('DSH 内容视图尚未创建。')
    return state.windows.dshView
  }

  function requireRecoveryView(): WebContentsView {
    if (state.windows.recoveryView === undefined) throw new Error('恢复内容视图尚未创建。')
    return state.windows.recoveryView
  }

  /** Minimum size while the DSH workbench is showing (the shell bar sits on top). */
  function showDshContentView(): void {
    if (state.windows.mainWindow !== undefined && !state.windows.mainWindow.isDestroyed()) state.windows.mainWindow.setMinimumSize(960, 640)
    state.windows.recoveryView?.setVisible(false)
    state.windows.dshView?.setVisible(true)
  }

  /** Minimum size is dropped for the recovery page so it can shrink on small screens. */
  function showRecoveryContentView(): void {
    state.windows.dshView?.setVisible(false)
    state.windows.recoveryView?.setVisible(true)
  }

  function layoutDshView(window: BrowserWindow): void {
    const bounds = window.getContentBounds()
    state.windows.dshView?.setBounds({ x: 0, y: SHELL_BAR_HEIGHT, width: bounds.width, height: Math.max(0, bounds.height - SHELL_BAR_HEIGHT) })
  }

  function layoutRecoveryView(window: BrowserWindow): void {
    const bounds = window.getContentBounds()
    state.windows.recoveryView?.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  }

  /**
   * Create the main window and its two content views.
   *
   * Attaches every listener the window needs, so callers only decide WHEN to create
   * it, never how. The store handles are assigned here; callers reach them through
   * `state.windows.*` (or the accessors above).
   */
  function createWindow(): BrowserWindow {
    const windowIcon = deps.resolveWindowIconImage()
    const palette = DESKTOP_THEME_PALETTES[state.shell.colorScheme]
    const window = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      show: true,
      title: DESKTOP_APP_NAME,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      // The small Windows non-client edge is painted from this color. Keep it
      // aligned with the title-bar wash instead of leaving a white seam above
      // the CSS gradient.
      backgroundColor: palette.titleBarBackground,
      // No `titleBarOverlay`: the caption buttons are DRAWN BY THE RENDERER
      // (frontend/shell/WindowControls.tsx). The native overlay can only paint a
      // SOLID color, so it could never follow the bar's vertical gradient — the
      // seam between a `#f6f7f6` bar and a `#f1f4f3` overlay plate was visible,
      // as was the jump from 72%-black HTML icons to a 100%-black native glyph.
      // Drawing all six controls in one document leaves exactly one color
      // authority, in both themes.
      ...(windowIcon === undefined ? {} : { icon: windowIcon }),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: deps.resolvePreload('shell-preload.cjs'),
        sandbox: true,
      },
    })
    const view = new WebContentsView({ webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: deps.resolvePreload('dsh-view-preload.cjs'),
      sandbox: true,
    } })
    const recovery = new WebContentsView({ webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: deps.resolvePreload('recovery-preload.cjs'),
      sandbox: true,
    } })
    state.windows.dshView = view
    state.windows.recoveryView = recovery
    window.contentView.addChildView(view)
    window.contentView.addChildView(recovery)
    recovery.setVisible(false)
    layoutDshView(window)
    layoutRecoveryView(window)
    window.on('resize', () => { layoutDshView(window); layoutRecoveryView(window) })
    window.on('maximize', () => { layoutDshView(window); layoutRecoveryView(window) })
    window.on('unmaximize', () => { layoutDshView(window); layoutRecoveryView(window) })
    deps.runTask(window.loadFile(deps.resolveShellAsset('shell.html'), { query: { theme: state.shell.colorScheme } }))

    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalOpenUrl(url, state.shell.allowedOrigin)) deps.runTask(shell.openExternal(url))
      return { action: 'deny' }
    })
    view.webContents.on('did-start-navigation', () => { state.shell.settingsDialogVisible = false })
    view.webContents.on('will-navigate', (event, url) => {
      if (deps.isNavigating()) {
        event.preventDefault()
        return
      }
      if (isSameOrigin(url, state.shell.allowedOrigin)) return
      event.preventDefault()
      if (isExternalOpenUrl(url, state.shell.allowedOrigin)) deps.runTask(shell.openExternal(url))
    })
    view.webContents.on('will-redirect', (event, url) => {
      if (isSameOrigin(url, state.shell.allowedOrigin)) return
      event.preventDefault()
      if (isExternalOpenUrl(url, state.shell.allowedOrigin)) deps.runTask(shell.openExternal(url))
    })
    recovery.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    deps.installShortcutHandler(window.webContents)
    deps.installShortcutHandler(view.webContents)
    applyInitialWindowState(window)
    window.on('enter-full-screen', deps.broadcastShellState)
    window.on('leave-full-screen', deps.broadcastShellState)
    window.on('close', event => {
      if (!shouldHideInsteadOfClose(state.runtime.isQuitting)) return
      event.preventDefault()
      window.hide()
    })
    window.on('closed', () => {
      if (state.windows.mainWindow === window) {
        state.windows.mainWindow = undefined
        state.windows.dshView = undefined
        state.windows.recoveryView = undefined
        state.recovery.profileDir = undefined
        state.recovery.failureMessage = undefined
        state.shell.settingsDialogVisible = false
      }
    })
    return window
  }


  /**
   * Get the main window, creating it on first use.
   *
   * All three call sites used `??= createWindow()`. Keeping that here means the
   * late-binding contract lives in exactly one place.
   */
  function ensureMainWindow(): BrowserWindow {
    return state.windows.mainWindow ??= createWindow()
  }

  /** Restore, show and focus the main window. No-op before it is created. */
  function showMainWindow(): void {
    if (state.windows.mainWindow === undefined) return
    if (state.windows.mainWindow.isMinimized()) state.windows.mainWindow.restore()
    state.windows.mainWindow.show()
    state.windows.mainWindow.focus()
  }

  return {
    requireDshView,
    requireRecoveryView,
    showDshContentView,
    showRecoveryContentView,
    layoutDshView,
    layoutRecoveryView,
    createWindow,
    ensureMainWindow,
    showMainWindow,
  }
}

/** The window registry surface, as returned by `createWindowRegistry`. */
export type WindowRegistry = ReturnType<typeof createWindowRegistry>
