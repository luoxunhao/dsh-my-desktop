/**
 * The startup / blocking-status window.
 *
 * UNLIKE THE OTHER REACT WINDOWS, this one has NO bridge.
 *
 * It is loaded into the `dshView` WebContents (see `showStartupWindow` in
 * `src/main.ts`), which runs `dsh-view-preload.cjs` — a preload that exposes the
 * DSH *content* API (`dshDesktopShell`), not the shell bootstrap API. So there is
 * no `getBootstrap`, no locale, and no theme broadcast available here.
 *
 * Two consequences shape this component, and both are load-bearing:
 *
 * 1. THEME COMES FROM THE URL. The main process appends `?theme=<scheme>` and the
 *    inline script in `startup.html` mirrors it onto `<html>`. That happens
 *    before this bundle runs, so the stylesheet is already correct on first paint
 *    and React never needs to know about the theme.
 *
 * 2. THE MESSAGE IS PUSHED BY `executeJavaScript`, INTO `#msg`. The main process
 *    updates the status text by evaluating JavaScript against a live DOM node
 *    (see `updateStartupMessage`). That is a hard contract this port must keep:
 *    the element with id `msg` has to exist and stay stable.
 *
 *    A React-owned text node would be clobbered by the next re-render, and the
 *    write would be invisible to React's reconciler. So `#msg` is rendered ONCE
 *    with its default text and then treated as an imperative escape hatch: React
 *    creates it and never updates its children again. The empty dependency list
 *    on the effect below is what guarantees that.
 *
 *    This is a deliberate, documented exception to "don't mix React with manual
 *    DOM". The alternative — adding a bridge to the DSH content preload — would
 *    widen that preload's surface for a cosmetic status string.
 */

import { useCallback, useEffect, useState } from 'react'

import { localize } from './api.js'

/** Read the theme the main process put on the URL, defaulting to dark. */
function readInitialLocale(): string {
  return navigator.language || 'zh-CN'
}

/**
 * The startup window cannot localize via the bootstrap (there is none), so it
 * falls back to the renderer's own locale. That is what the original did
 * implicitly through the hard-coded Chinese text; making it explicit here keeps
 * the English branch reachable when Electron reports an English locale.
 */
function useDocumentLocale(): string {
  const [locale] = useState(readInitialLocale)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return locale
}

export function StartupWindow(): React.JSX.Element {
  const locale = useDocumentLocale()

  /**
   * Publish a no-op ref callback purely to document the contract in code: this
   * node is handed to the main process and must not be re-created.
   */
  const keepMsgStable = useCallback(() => undefined, [])

  return (
    <main className="stage">
      <img className="icon" src="./icon.png" alt="DSH My Desktop" />
      <div className="spinner" aria-hidden="true" />
      <section className="status" role="status" aria-live="polite" aria-atomic="true">
        <h1>DSH My Desktop</h1>
        {/*
          Do NOT make this content dynamic. `updateStartupMessage` in src/main.ts
          writes into this exact element by id. React children here would be
          overwritten on the next render and the status would appear to freeze.
        */}
        <p id="msg" ref={keepMsgStable}>{localize(locale, '正在启动', 'Starting')}</p>
      </section>
    </main>
  )
}
