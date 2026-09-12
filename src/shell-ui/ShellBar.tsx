/**
 * The launcher's title bar.
 *
 * This is the React replacement for `assets/shell.html`. It renders the three
 * toolbar tools on the left, the centred identity block, and — crucially — the
 * caption buttons on the right, which are now DRAWN HERE instead of by Electron's
 * native overlay.
 *
 * THE COLOR SEAM THIS FIXES
 * -------------------------
 * The old arrangement had two independent color authorities in one bar. The
 * toolbar icons were HTML, styled by a filter; the caption buttons were native,
 * painted by Windows from a hard-coded `symbolColor`, and could only ever be a
 * SOLID color — so they could not follow the bar's gradient. The visible results
 * were a seam where the gradient ended at `#f6f7f6` against a `#f1f4f3` overlay
 * plate, and a jump from 72%-black HTML glyphs to a 100%-black native one.
 *
 * Both sets of icons now read the same custom properties, and the caption color
 * arrives through the bootstrap rather than being hard-coded here, so the two
 * cannot drift apart again.
 */

import { useCallback, useEffect, useState } from 'react'

import { applyColorScheme, localize, shellBridge } from './api.js'
import type { ShellBootstrap, ShellState, ShellToolId } from './api.js'
import { WindowControls } from './WindowControls.js'

/**
 * Toolbar tools and their icon files.
 *
 * `popup` marks the tools that open a native context menu anchored to the
 * button rather than firing a one-shot action. The distinction matters because
 * the main process validates the two on different channels.
 */
const TOOLS: readonly {
  readonly id: ShellToolId
  readonly icon: string
  readonly popup: boolean
  readonly zh: string
  readonly en: string
}[] = [
  { id: 'terminal', icon: 'shell-icons/terminal.svg', popup: false, zh: '打开终端', en: 'Open terminal' },
  { id: 'reload', icon: 'shell-icons/rotate.svg', popup: true, zh: '重启选项', en: 'Reload options' },
  { id: 'developer', icon: 'shell-icons/wrench.svg', popup: true, zh: '开发者选项', en: 'Developer options' },
]

function useShellBar(locale: string) {
  const [state, setState] = useState<ShellState | undefined>(undefined)
  const [openTool, setOpenTool] = useState<ShellToolId | undefined>(undefined)

  useEffect(() => {
    const api = shellBridge()
    let active = true
    const apply = (value: unknown): void => {
      if (active) setState(value as ShellState)
    }
    const unsubscribe = api.onState(apply)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  /**
   * Open a tool's popup menu, anchored under its button.
   *
   * The bridge call resolves when the native menu CLOSES, so the button is held
   * in the `openTool` state for its whole lifetime — that is what keeps
   * `aria-expanded` honest. A rejected call must still clear it, hence the
   * `finally`.
   */
  const openPopup = useCallback(async (tool: ShellToolId, button: HTMLElement): Promise<void> => {
    const rect = button.getBoundingClientRect()
    setOpenTool(tool)
    try {
      await shellBridge().popupTool(tool, rect.left, rect.bottom)
    } finally {
      setOpenTool(current => (current === tool ? undefined : current))
    }
  }, [])

  const runTool = useCallback((tool: ShellToolId): void => {
    void shellBridge().tool(tool)
  }, [])

  /**
   * Dismiss the open tool popup when the user clicks elsewhere or the window
   * loses focus.
   *
   * The native menu closes itself, but `aria-expanded` would stay stuck on the
   * button until the invoke promise settles, so this clears it eagerly. It lives
   * inside the hook because `setOpenTool` is hook state — the caller only needs
   * to read `openTool`.
   */
  useEffect(() => {
    if (openTool === undefined) return
    const clear = (): void => setOpenTool(undefined)
    document.addEventListener('pointerdown', clear, true)
    window.addEventListener('blur', clear)
    return () => {
      document.removeEventListener('pointerdown', clear, true)
      window.removeEventListener('blur', clear)
    }
  }, [openTool])

  const status = state?.reloading === true
    ? localize(locale, '正在重新加载…', 'Reloading…')
    : ''

  return { status, openTool, openPopup, runTool }
}

export function ShellBar(): React.JSX.Element | null {
  const [bootstrap, setBootstrap] = useState<ShellBootstrap | undefined>(undefined)

  useEffect(() => {
    const api = shellBridge()
    let active = true
    const apply = (value: unknown): void => {
      if (!active) return
      const next = value as ShellBootstrap
      setBootstrap(next)
      // The bar is the page: locale drives `lang`, and the theme drives the
      // custom properties the stylesheet reads.
      document.documentElement.lang = next.locale
      document.documentElement.dataset.platform = next.platform
      /*
       * Mirror the theme onto <html> on every bootstrap, not just the first.
       *
       * `shell.html` applies `?theme=` before first paint, which covers the
       * initial load only — a live theme change arrives over IPC, so without
       * this line the bar keeps the scheme it was born with while every other
       * window re-themes. This is the one call site the other shell renderers
       * (AboutWindow, ShortcutsWindow, SettingsWindow, use-shell) all had and
       * the bar did not, which is why it alone stayed dark in light mode.
       */
      applyColorScheme(next.colorScheme)
    }
    const unsubscribe = api.onBootstrap(apply)
    void api.getBootstrap().then(apply, () => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const locale = bootstrap?.locale ?? 'zh-CN'
  const { status, openTool, openPopup, runTool } = useShellBar(locale)

  if (bootstrap === undefined) return null

  return (
    <header
      className="bar"
      aria-label="DSH My Desktop"
      style={{
        /*
         * Published by the main process so the renderer never guesses a caption
         * color. See the module note above.
         *
         * The name MUST match the custom property `bar.css` reads
         * (`.caption-button { color: var(--titlebar-fg) }`). A mismatch does not
         * fail loudly — the declaration lands on the element, nothing consumes
         * it, and the CSS falls back to the dark-theme default, so the caption
         * glyphs render dark-on-light in light mode.
         */
        ['--titlebar-fg' as string]: bootstrap.titleBar.symbol,
      }}
    >
      <div className="bar-tools">
        {TOOLS.map(tool => (
          <button
            key={tool.id}
            type="button"
            className="icon"
            title={localize(locale, tool.zh, tool.en)}
            aria-label={localize(locale, tool.zh, tool.en)}
            aria-haspopup={tool.popup ? 'menu' : undefined}
            aria-expanded={tool.popup ? openTool === tool.id : undefined}
            onClick={event => {
              if (tool.popup) void openPopup(tool.id, event.currentTarget)
              else runTool(tool.id)
            }}
          >
            <img src={tool.icon} alt="" />
          </button>
        ))}
      </div>

      <span className="identity">
        <span className="word" aria-hidden="true">DSH My Desktop</span>
        <button
          type="button"
          id="version"
          className="version"
          title={localize(locale, '关于 DSH My Desktop', 'About DSH My Desktop')}
          aria-label={localize(locale, '关于 DSH My Desktop', 'About DSH My Desktop')}
          aria-haspopup="dialog"
          onClick={() => { void shellBridge().action('about') }}
        >
          <span>v{bootstrap.version}</span>
          <img className="chevron" src="shell-icons/chevron-down.svg" alt="" />
        </button>
      </span>

      <span className="status" role="status">{status}</span>

      {/*
        Only Windows/Linux draw their own caption buttons; macOS keeps the native
        traffic lights, which `titleBarStyle: 'hiddenInset'` reserves space for.
        Rendering them on macOS would double up with the system's own controls.
      */}
      {bootstrap.platform === 'darwin' ? null : <WindowControls locale={locale} />}
    </header>
  )
}
