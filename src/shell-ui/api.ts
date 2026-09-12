/**
 * Typed access to the `dshShell` bridge exposed by `src/shell-preload.cts`.
 *
 * The preload exposes its methods as `(value: unknown) => Promise<unknown>` on
 * purpose: `contextBridge` payloads cross a structured-clone boundary, so the
 * preload stays free of the launcher's type vocabulary and the renderer is the
 * one place that asserts the shapes. This module is that single assertion point;
 * nothing else in `src/shell-ui` should touch `window.dshShell` directly.
 *
 * Every window in the launcher shares this bridge, but not every window can use
 * every method — the preload exposes a superset. That is why access is split
 * into the focused views below rather than one wide interface: a window that
 * only needs the shell bar cannot accidentally call an update-preference setter
 * that its IPC policy would reject.
 */

import type { ShellBootstrap, ShellState, ShellToolId } from '../desktop/shell-contract.js'

/** The raw, untyped surface the preload installs on `window`. */
interface RawShellBridge {
  readonly platform: NodeJS.Platform
  action(id: string): Promise<unknown>
  tool(tool: string): Promise<unknown>
  popupTool(tool: string, x: number, y: number): Promise<unknown>
  getBootstrap(): Promise<unknown>
  windowControl(command: 'minimize' | 'toggle-maximize' | 'close'): Promise<unknown>
  getWindowState(): Promise<unknown>
  getNotificationPreferences(): Promise<unknown>
  updateNotificationPreferences(value: unknown): Promise<unknown>
  getUpdatePreferences(): Promise<unknown>
  updateUpdatePreferences(value: unknown): Promise<unknown>
  getDesktopUpdateState(): Promise<unknown>
  desktopUpdateAction(action: unknown): Promise<unknown>
  closeDesktopSettings(): Promise<unknown>
  onState(listener: (state: unknown) => void): () => void
  onBootstrap(listener: (bootstrap: unknown) => void): () => void
  onDesktopUpdateState(listener: (state: unknown) => void): () => void
  onSettingsSection(listener: (section: unknown) => void): () => void
  popupMenu(request: unknown): Promise<unknown>
}

declare global {
  interface Window {
    readonly dshShell: RawShellBridge
  }
}

export function shellBridge(): RawShellBridge {
  return window.dshShell
}

/** `true` for locales the launcher ships copy for. */
export function isZhLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith('zh')
}

/**
 * Pick the Chinese or English string for a locale.
 *
 * Deliberately the smallest possible i18n: the launcher ships exactly two
 * locales and every call site already knows both strings. A lookup table would
 * be more machinery than the problem has.
 */
export function localize(locale: string, zh: string, en: string): string {
  return isZhLocale(locale) ? zh : en
}

/**
 * Mirror the resolved theme onto the document element.
 *
 * Both `data-color-scheme` (which the stylesheets key off) and the CSS
 * `color-scheme` property (which drives native scrollbars and form controls)
 * must be set, and they are set in two different ways — an attribute and a style
 * property. Missing either one produces a half-themed window, so they live
 * together here.
 */
export function applyColorScheme(colorScheme: ShellBootstrap['colorScheme']): void {
  const root = document.documentElement
  root.dataset.colorScheme = colorScheme
  root.style.colorScheme = colorScheme
}

export type { ShellBootstrap, ShellState, ShellToolId }
