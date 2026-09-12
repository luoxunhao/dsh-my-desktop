export type DesktopColorScheme = 'light' | 'dark'
export type DesktopThemePreference = DesktopColorScheme | 'system'

export interface DesktopThemeSnapshot {
  readonly colorScheme: DesktopColorScheme
  readonly preference?: DesktopThemePreference
}

export interface DesktopThemePalette {
  readonly aboutBackground: string
  readonly settingsBackground: string
  readonly shellBackground: string
  readonly shortcutsBackground: string
  /**
   * Native window background before the renderer's first paint.
   *
   * Set on the `BrowserWindow` itself (`backgroundColor`) and on
   * `setBackgroundColor` during a theme change. It no longer feeds a
   * `titleBarOverlay`, because the caption buttons are renderer-drawn — see
   * `frontend/shell/WindowControls.tsx`. It only needs to match the bar closely
   * enough that the pre-paint flash is not a visible seam.
   */
  readonly titleBarBackground: string
  /**
   * Caption-glyph color, consumed by the renderer as a CSS custom property.
   *
   * Previously this was pushed into Electron's native `titleBarOverlay`, which
   * could not follow the bar's gradient and produced a visible jump against the
   * HTML icons beside it. It is now published to the renderer (via the shell
   * bootstrap) so both sets of icons read the SAME value.
   */
  readonly titleBarSymbol: string
}

export const DESKTOP_THEME_PALETTES: Readonly<Record<DesktopColorScheme, DesktopThemePalette>> = {
  light: {
    aboutBackground: '#ffffff',
    settingsBackground: '#ffffff',
    shellBackground: '#ffffff',
    shortcutsBackground: '#ffffff',
    // Must match the RIGHT-hand stop of the shell bar's gradient in
    // frontend/shell/styles.css, because that is the color the bar actually has
    // where the caption buttons sit. It is used for the window's pre-paint
    // background, so a mismatch shows as a flash on startup.
    titleBarBackground: '#f6f7f6',
    // ~72% black, matching the left-hand HTML icons' `brightness(0) opacity(.72)`
    // treatment. Both sets of icons now use this value.
    titleBarSymbol: '#474747',
  },
  dark: {
    aboutBackground: '#202322',
    settingsBackground: '#202322',
    shellBackground: '#171918',
    shortcutsBackground: '#262827',
    // Right-hand stop of the dark bar gradient — see the light-theme note above.
    titleBarBackground: '#1d201e',
    // Already equal to the dark HTML icons' effective output, so the two icon
    // sets match in dark mode with no further adjustment.
    titleBarSymbol: '#d7d9d8',
  },
}

export function normalizeDesktopColorScheme(value: unknown): DesktopColorScheme | undefined {
  return value === 'light' || value === 'dark' ? value : undefined
}

export function normalizeDesktopThemeSnapshot(value: unknown): DesktopThemeSnapshot | undefined {
  const legacyColorScheme = normalizeDesktopColorScheme(value)
  if (legacyColorScheme !== undefined) return { colorScheme: legacyColorScheme }
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { colorScheme?: unknown; preference?: unknown }
  const colorScheme = normalizeDesktopColorScheme(candidate.colorScheme)
  if (colorScheme === undefined) return undefined
  const preference = candidate.preference === 'light' || candidate.preference === 'dark' || candidate.preference === 'system'
    ? candidate.preference
    : undefined
  return preference === undefined ? { colorScheme } : { colorScheme, preference }
}
