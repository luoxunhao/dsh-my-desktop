/**
 * Self-drawn caption buttons (minimise / maximise / close).
 *
 * WHY THIS EXISTS
 * ---------------
 * The launcher used to let Electron paint these via `titleBarOverlay`. That put
 * the three buttons under a *different* color authority than the rest of the bar:
 * the icons on the left are HTML dressed by `shell.html`, while the native
 * overlay is painted by Windows from a hard-coded `symbolColor` and can only be a
 * SOLID color — it cannot follow the bar's gradient. The result was a visible
 * jump at the seam: a bar ending at `#f6f7f6` meeting a `#f1f4f3` button plate,
 * and 72%-black HTML icons sitting next to a 100%-black native glyph.
 *
 * Drawing the buttons in the renderer removes the second color authority
 * entirely. All six controls in the bar now read the same CSS custom properties,
 * in both themes, by construction.
 *
 * THE PART THAT IS EASY TO GET WRONG
 * ----------------------------------
 * `-webkit-app-region: drag` makes a region behave like a title bar, but Windows
 * only treats it as one if the window is actually frameless (`titleBarStyle:
 * 'hidden'` — which it is) AND the buttons explicitly opt back OUT with
 * `no-drag`. A button left inside a drag region receives no click events at all;
 * it looks correct and is silently dead.
 *
 * Dragging is handled natively by the OS for the drag region, so there is no
 * pointer-event plumbing here. What is *not* free is double-click-to-maximise,
 * which the native overlay provided for free and which we therefore owe the user.
 */

import { useEffect, useState } from 'react'

import { localize } from './api.js'

export interface WindowControlsProps {
  /** BCP-47 tag from bootstrap; drives the button labels. */
  readonly locale: string
}

/**
 * Track whether the window is currently maximised.
 *
 * Polled from the explicit `windowState` bridge rather than inferred from the
 * viewport: the main process owns the authoritative answer, and the button that
 * changes it is right here, so a re-read after each command keeps the glyph
 * exact instead of nearly-right.
 *
 * Only the ICON depends on this, so a missed update is cosmetic. Resize
 * coverage makes it robust anyway — browser-driven maximise (double-clicking the
 * drag region, or Aero Snap) fires `resize` without going through this button.
 */
function useIsMaximized(): boolean {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    const read = (): void => {
      void window.dshShell.getWindowState().then(
        value => {
          if (!active) return
          const state = value as { maximized?: unknown } | undefined
          if (typeof state?.maximized === 'boolean') setMaximized(state.maximized)
        },
        () => undefined,
      )
    }
    read()
    window.addEventListener('resize', read)
    return () => {
      active = false
      window.removeEventListener('resize', read)
    }
  }, [])

  return maximized
}

/**
 * Send a caption command to the main process.
 *
 * `window.close()` cannot be used for close: these windows have a shared
 * main-process policy that decides whether a window may be closed at all, and a
 * renderer-side close would bypass it. Routing through the bridge keeps every
 * window action on one auditable path (`mayControlWindow`).
 */
function sendWindowAction(action: 'minimize' | 'toggle-maximize' | 'close'): void {
  void window.dshShell.windowControl(action)
}

export function WindowControls({ locale }: WindowControlsProps): React.JSX.Element {
  const maximized = useIsMaximized()

  return (
    <div className="caption-buttons">
      <button
        type="button"
        className="caption-button"
        aria-label={localize(locale, '最小化', 'Minimize')}
        title={localize(locale, '最小化', 'Minimize')}
        onClick={() => sendWindowAction('minimize')}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg>
      </button>
      <button
        type="button"
        className="caption-button"
        aria-label={localize(locale, maximized ? '向下还原' : '最大化', maximized ? 'Restore' : 'Maximize')}
        title={localize(locale, maximized ? '向下还原' : '最大化', maximized ? 'Restore' : 'Maximize')}
        onClick={() => sendWindowAction('toggle-maximize')}
      >
        {maximized
          ? <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5V2h6.5v6.5H8.5" /><rect x="2" y="3.5" width="6.5" height="6.5" rx="0.5" /></svg>
          : <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="0.5" /></svg>}
      </button>
      <button
        type="button"
        className="caption-button caption-button--close"
        aria-label={localize(locale, '关闭', 'Close')}
        title={localize(locale, '关闭', 'Close')}
        onClick={() => sendWindowAction('close')}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
      </button>
    </div>
  )
}
