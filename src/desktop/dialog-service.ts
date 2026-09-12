/**
 * The three auxiliary windows: desktop settings, keyboard shortcuts, About.
 *
 * WHAT THESE SHARE (and why they are one module)
 * ----------------------------------------------
 * All three follow the same shape — reuse-or-create, then configure:
 *
 *   1. if the handle exists and is alive → show + focus, return
 *   2. otherwise create a BrowserWindow parented to the main window,
 *      with the shell preload and the theme's background colour
 *   3. strip the native menu, guard the Windows owned-window flash
 *   4. store the handle and clear it on 'closed'
 *   5. install the shortcut handler, then load an asset with the theme query
 *
 * That template is factored into `openDialogWindow` below. Each caller supplies
 * only what genuinely differs: size, modality, chrome, title, asset, background.
 * The settings window additionally re-sends its section and the update snapshot on
 * load, so it passes an `onLoaded` hook rather than getting a bespoke code path.
 *
 * WHERE THE HANDLES LIVE
 * ----------------------
 * The `state.windows.*` fields stay on the store — this module reads and writes them
 * through injected accessors rather than importing the store wholesale. That keeps
 * the late-binding contract intact (handles are read at call time, never captured)
 * and makes the dependencies visible: own handle, main window for parenting, and the
 * current colour scheme.
 */
import { BrowserWindow } from 'electron'

import { DESKTOP_APP_NAME } from '../app/app-identity.js'
import { SHELL_IPC } from './shell-contract.js'
import { DESKTOP_THEME_PALETTES, type DesktopColorScheme } from './desktop-theme.js'

/** Section the settings window should show when opened. */
export type DesktopSettingsSection = 'notifications' | 'updates'

export interface DialogDeps {
  /** Read/write the three dialog handles plus the main window they parent to. */
  mainWindow: () => BrowserWindow | undefined
  settingsWindow: {
    get: () => BrowserWindow | undefined
    set: (window: BrowserWindow | undefined) => void
  }
  shortcutsWindow: {
    get: () => BrowserWindow | undefined
    set: (window: BrowserWindow | undefined) => void
  }
  aboutWindow: {
    get: () => BrowserWindow | undefined
    set: (window: BrowserWindow | undefined) => void
  }
  /** Current colour scheme, read at open time so a theme change is picked up. */
  colorScheme: () => DesktopColorScheme
  /** Localized string helper bound to the shell locale. */
  text: (zh: string, en: string) => string
  /** Resolve a shell asset path (settings/shortcuts/about HTML). */
  resolveShellAsset: (name: 'shell.html' | 'shortcuts.html' | 'about.html' | 'settings.html') => string
  /** Resolve a preload script's compiled path. */
  resolvePreload: (name: 'shell-preload.cjs' | 'dsh-view-preload.cjs' | 'recovery-preload.cjs') => string
  /** Window icon for the About window. */
  resolveWindowIconImage: () => Electron.NativeImage | undefined
  /** Attach the top-bar keyboard shortcut handler. */
  installShortcutHandler: (contents: Electron.WebContents) => void
  /** Snapshot of update state for the settings window's initial payload. */
  updateSnapshot: () => unknown
  /** Fire-and-forget task runner funnelling rejections to the error reporter. */
  runTask: (task: Promise<unknown>) => void
}

/** Options that actually differ between the three dialogs. */
interface DialogWindowOptions {
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  modal?: boolean
  frame?: boolean
  resizable?: boolean
  minimizable?: boolean
  maximizable?: boolean
  fullscreenable?: boolean
  title: string
  background: string
  asset: 'settings.html' | 'shortcuts.html' | 'about.html'
  /** Optional window icon (the About window sets one). */
  icon?: Electron.NativeImage
  /** Extra work once the page has loaded (the settings window's initial payload). */
  onLoaded?: (window: BrowserWindow) => void
}

export function createDialogService(deps: DialogDeps) {
  /**
   * Strip the native menu bar. Skipped on macOS, where the menu belongs to the app
   * rather than the window and removing it would blank the global menu bar.
   */
  function removeNativeWindowMenu(window: BrowserWindow): void {
    if (process.platform === 'darwin') return
    window.setMenu(null)
    window.setMenuBarVisibility(false)
  }

  /**
   * Windows flashes the whole window when a parent/modal child closes, because the
   * OS re-enables the owner. Detaching the parent before close avoids the flash.
   *
   * MODAL WINDOWS MUST BE SKIPPED. Electron refuses `setParentWindow` on a modal
   * window with "Can not be called for modal window" (verified against the bundled
   * Electron 44) — including the `null` detach used here. The throw happens inside
   * the `close` handler, so it does not abort the close: the window still goes away,
   * but the exception reaches `process.on('uncaughtException')`, which the launcher
   * treats as a startup failure and answers by replacing the main window with the
   * "启动失败" page. In practice that meant closing About (or Shortcuts) *looked*
   * like it worked and then killed the app's UI.
   *
   * Modal windows do not need the workaround anyway: the OS keeps them in front of
   * their owner, so there is no window to flash behind them.
   */
  function preventWindowsOwnedWindowFlash(window: BrowserWindow): void {
    if (window.isModal()) return
    window.on('close', () => {
      if (process.platform !== 'win32' || window.isDestroyed() || window.getParentWindow() === null) return
      window.setParentWindow(null)
    })
  }

  /**
   * Shared open-or-focus path for all three dialogs.
   *
   * `slot` is the store accessor pair for this dialog's handle; the template writes
   * the handle through it and clears it on 'closed', so a closed window is never
   * reused and a live one is always focused rather than duplicated.
   */
  function openDialogWindow(
    slot: { get: () => BrowserWindow | undefined, set: (window: BrowserWindow | undefined) => void },
    options: DialogWindowOptions,
  ): BrowserWindow {
    const existing = slot.get()
    if (existing !== undefined && !existing.isDestroyed()) return existing

    const window = new BrowserWindow({
      parent: deps.mainWindow(),
      width: options.width,
      height: options.height,
      ...(options.minWidth === undefined ? {} : { minWidth: options.minWidth }),
      ...(options.minHeight === undefined ? {} : { minHeight: options.minHeight }),
      ...(options.maxWidth === undefined ? {} : { maxWidth: options.maxWidth }),
      ...(options.maxHeight === undefined ? {} : { maxHeight: options.maxHeight }),
      ...(options.modal === undefined ? {} : { modal: options.modal }),
      ...(options.frame === undefined ? {} : { frame: options.frame }),
      ...(options.resizable === undefined ? {} : { resizable: options.resizable }),
      ...(options.minimizable === undefined ? {} : { minimizable: options.minimizable }),
      ...(options.maximizable === undefined ? {} : { maximizable: options.maximizable }),
      ...(options.fullscreenable === undefined ? {} : { fullscreenable: options.fullscreenable }),
      title: options.title,
      autoHideMenuBar: true,
      ...(options.icon === undefined ? {} : { icon: options.icon }),
      backgroundColor: options.background,
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload: deps.resolvePreload('shell-preload.cjs'), sandbox: true },
    })
    removeNativeWindowMenu(window)
    preventWindowsOwnedWindowFlash(window)
    slot.set(window)
    window.on('closed', () => { if (slot.get() === window) slot.set(undefined) })
    deps.installShortcutHandler(window.webContents)
    if (options.onLoaded !== undefined) window.webContents.once('did-finish-load', () => options.onLoaded!(window))
    deps.runTask(window.loadFile(deps.resolveShellAsset(options.asset), { query: { theme: deps.colorScheme() } }))
    return window
  }

  /** Show and focus an already-open dialog, or create it. */
  function reveal(slot: { get: () => BrowserWindow | undefined }): boolean {
    const existing = slot.get()
    if (existing === undefined || existing.isDestroyed()) return false
    existing.show()
    existing.focus()
    return true
  }

  function showDesktopSettingsWindow(section: DesktopSettingsSection = 'notifications'): void {
    if (reveal(deps.settingsWindow)) {
      deps.settingsWindow.get()!.webContents.send(SHELL_IPC.settingsSection, section)
      return
    }
    openDialogWindow(deps.settingsWindow, {
      width: 760,
      height: 620,
      minWidth: 680,
      minHeight: 540,
      title: deps.text('桌面端设置', 'Desktop Settings'),
      background: DESKTOP_THEME_PALETTES[deps.colorScheme()].settingsBackground,
      asset: 'settings.html',
      onLoaded: window => {
        window.webContents.send(SHELL_IPC.settingsSection, section)
        window.webContents.send(SHELL_IPC.desktopUpdateState, deps.updateSnapshot())
      },
    })
  }

  function showShortcutsWindow(): void {
    if (reveal(deps.shortcutsWindow)) return
    openDialogWindow(deps.shortcutsWindow, {
      width: 620,
      height: 650,
      minWidth: 520,
      minHeight: 480,
      modal: true,
      title: deps.text('键盘快捷键', 'Keyboard Shortcuts'),
      background: DESKTOP_THEME_PALETTES[deps.colorScheme()].shortcutsBackground,
      asset: 'shortcuts.html',
    })
  }

  function showAboutWindow(): void {
    if (reveal(deps.aboutWindow)) return
    const icon = deps.resolveWindowIconImage()
    openDialogWindow(deps.aboutWindow, {
      width: 560,
      height: 680,
      minWidth: 560,
      minHeight: 680,
      maxWidth: 560,
      maxHeight: 680,
      modal: true,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: deps.text(`关于 ${DESKTOP_APP_NAME}`, `About ${DESKTOP_APP_NAME}`),
      background: DESKTOP_THEME_PALETTES[deps.colorScheme()].aboutBackground,
      asset: 'about.html',
      ...(icon === undefined ? {} : { icon }),
    })
  }

  return { showDesktopSettingsWindow, showShortcutsWindow, showAboutWindow }
}

export type DialogService = ReturnType<typeof createDialogService>
