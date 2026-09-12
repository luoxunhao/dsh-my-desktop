import type { ShellActionId } from './shell-actions.js'

export type ShellRendererKind = 'main' | 'shortcuts' | 'about' | 'settings' | 'dsh' | 'unknown'

export function mayGetShellBootstrap(kind: ShellRendererKind): boolean {
  return kind === 'main' || kind === 'shortcuts' || kind === 'about' || kind === 'settings'
}

export function mayInvokeShellAction(kind: ShellRendererKind, id: ShellActionId): boolean {
  if (kind === 'main') return true
  return kind === 'about' && (id === 'whats-new' || id === 'feedback')
}

export function mayPopupShellMenu(kind: ShellRendererKind): boolean {
  return kind === 'main'
}

export function mayReportDshState(kind: ShellRendererKind): boolean {
  return kind === 'dsh'
}

export function mayReportDshBoot(kind: ShellRendererKind): boolean {
  return kind === 'dsh'
}

export function mayReportDshNotification(kind: ShellRendererKind): boolean {
  return kind === 'dsh'
}

export function mayReportDshLocale(kind: ShellRendererKind): boolean {
  return kind === 'dsh'
}

export function mayReportDshTheme(kind: ShellRendererKind): boolean {
  return kind === 'dsh'
}

export function mayReportDshSettingsVisibility(kind: ShellRendererKind): boolean {
  return kind === 'dsh'
}

export function mayAccessNotificationPreferences(kind: ShellRendererKind): boolean {
  return kind === 'settings'
}

export function mayAccessDesktopUpdates(kind: ShellRendererKind): boolean {
  return kind === 'settings'
}

export function mayCloseDesktopSettings(kind: ShellRendererKind): boolean {
  return kind === 'settings'
}

/**
 * Caption-button commands.
 *
 * Only windows that DRAW their own title bar may send these. `main`, `about` and
 * `shortcuts` do; `settings` keeps its own single close button on the existing
 * `closeDesktopSettings` channel; `dsh` is a remote-content view and must never
 * be able to close or minimise its host window.
 *
 * The gate is per-command rather than per-window because `close` is the
 * destructive one: a compromised `dsh` renderer that could close the window
 * would deny service to the whole app. Keeping `dsh` and `unknown` out entirely
 * means the check fails closed for any renderer added later without a decision.
 */
export function mayControlWindow(kind: ShellRendererKind): boolean {
  return kind === 'main' || kind === 'about' || kind === 'shortcuts'
}

/**
 * Read the maximised state, used to pick the maximise-vs-restore glyph.
 *
 * Read-only and harmless, so it follows the same window set as the commands it
 * describes — anything drawing caption buttons needs to render the right icon.
 */
export function mayReadWindowState(kind: ShellRendererKind): boolean {
  return mayControlWindow(kind)
}
