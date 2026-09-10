/**
 * Lightweight IPC helpers extracted from main.ts.
 *
 * These reference ONLY the state store and WebContents (from `electron`),
 * keeping the heavy Electron types (Menu, BrowserWindow) in main.ts.
 */

/** Marionette script: find and click the DSH settings dialog close button. */
export const DISMISS_DSH_SETTINGS_DIALOG_SCRIPT: string = `(() => {
  const label = (element) => ((element.getAttribute('aria-label') || '') + ' ' + (element.textContent || '')).replace(/\\s+/g, ' ').trim().toLowerCase()
  const dialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
    .find((element) => {
      if (element.offsetParent === null) return false
      const titleId = element.getAttribute('aria-labelledby')
      const title = titleId === null ? null : document.getElementById(titleId)
      return title !== null && /^(设置|settings)$/i.test(label(title))
    })
  if (!dialog) return false
  const close = [...dialog.querySelectorAll('button')]
    .find((element) => /^(关闭|close)$/i.test(label(element)))
  if (!close) return false
  close.click()
  return true
})()`

export function dismissDshSettingsDialog(dshView: { webContents: { isDestroyed: () => boolean; executeJavaScript: (script: string) => Promise<unknown> } } | undefined): void {
  if (dshView === undefined || dshView.webContents.isDestroyed()) return
  void dshView.webContents.executeJavaScript(DISMISS_DSH_SETTINGS_DIALOG_SCRIPT).catch(() => undefined)
}

export function sendDshAction(dshView: { webContents: { isDestroyed: () => boolean; send: (channel: string, ...args: unknown[]) => void } } | undefined, id: string): void {
  if (dshView !== undefined && !dshView.webContents.isDestroyed()) {
    dshView.webContents.send('dsh-shell:dsh-action', id)
  }
}

export function shellRendererKind(
  mainWindow: { webContents: unknown } | undefined,
  shortcutsWindow: { webContents: unknown } | undefined,
  aboutWindow: { webContents: unknown } | undefined,
  settingsWindow: { webContents: unknown } | undefined,
  dshView: { webContents: unknown } | undefined,
  sender: unknown,
): string {
  if (sender === mainWindow?.webContents) return 'main'
  if (sender === shortcutsWindow?.webContents) return 'shortcuts'
  if (sender === aboutWindow?.webContents) return 'about'
  if (sender === settingsWindow?.webContents) return 'settings'
  if (sender === dshView?.webContents) return 'dsh'
  return 'unknown'
}

export function isActionEnabled(
  runtime: { isRecycling: boolean },
  launch: { lastStartOptions: unknown; lastSeedOptions: unknown },
  shell: { navigationState: { canBack: boolean; canForward: boolean; canPreviousChat: boolean; canNextChat: boolean } },
  id: string,
): boolean {
  if (id === 'reload') return !runtime.isRecycling && launch.lastStartOptions !== undefined && launch.lastSeedOptions !== undefined
  if (id === 'back') return shell.navigationState.canBack
  if (id === 'forward') return shell.navigationState.canForward
  if (id === 'previous-chat') return shell.navigationState.canPreviousChat
  if (id === 'next-chat') return shell.navigationState.canNextChat
  return true
}
