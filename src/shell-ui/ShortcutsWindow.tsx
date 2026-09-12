/**
 * The keyboard-shortcuts window.
 *
 * This is the React replacement for `assets/shortcuts.html`. The original built
 * its whole list with imperative DOM calls (`createElement` + `replaceChildren`)
 * behind a single `render()` that re-ran on every keystroke. Here the query is
 * React state and the sections and rows are elements, so the same behavior falls
 * out of a normal render — no node-by-node rebuild, and no way for the DOM to
 * drift from the data that produced it.
 *
 * WHAT THE FILTER IS ACTUALLY DOING
 * ---------------------------------
 * Two rules from the original that are easy to "improve" and get wrong:
 *
 *   1. `label + ' ' + keywords + ' ' + acceleratorLabel` is the ONLY text that
 *      is matched — the menu name is not searchable. The accelerator is matched
 *      in its RENDERED form (`Ctrl+/`, `⌘N`), so typing what the user actually
 *      sees on the right-hand side of a row finds that row.
 *   2. Only actions with an `acceleratorLabel` are candidates at all. A menu item
 *      that has no keyboard shortcut is not a shortcut and is never listed, no
 *      matter what it is called. In the current action table that deliberately
 *      drops every row that has no accelerator (Delete, the two settings
 *      entries, What's New, Feedback, Check for Updates, About) plus the two
 *      whose accelerator is a plain modifier (`zoom-in` is sent as
 *      `CmdOrCtrl+Shift+Plus` and formatted to `Ctrl+Shift+=`, and
 *      `toggle-fullscreen` is `F11` — both DO have one and both are listed).
 *
 * `keywords` is emptied rather than omitted for actions that have none, so the
 * concatenation never produces the string "undefined" to match against.
 *
 * GROUPING
 * --------
 * Sections follow `bootstrap.menus` (menu order), and each section takes only the
 * matching actions whose `menu` equals that menu's id. A section with no rows is
 * omitted entirely rather than rendered as an empty heading — so a search that
 * matches one Edit action produces exactly one section, not four.
 */

import { useEffect, useRef, useState } from 'react'

import { applyColorScheme, localize, shellBridge } from './api.js'
import type { ShellBootstrap } from './api.js'

/**
 * Split a formatted accelerator into the glyphs that each get their own `<kbd>`.
 *
 * Ported verbatim from the original's `parts` helper, including the two things
 * that look like mistakes and are not:
 *
 *   - The `Cmd` → `⌘` replacement targets the EXACT substring `Cmd`, so it can
 *     never touch `CmdOrCtrl` — that string is already resolved to `Cmd` or
 *     `Ctrl` by the time it reaches here (see `formatAccelerator`). It only fires
 *     on macOS, where the label really is `⌘+N`.
 *   - The `Ctrl` → `Ctrl` replacement is an identity no-op. It is kept because it
 *     documents the intent at exactly the point where the accelerator is split
 *     and is harmless to leave in place; removing it would change nothing.
 *
 * Splitting on `+` is why `Ctrl+Shift+=` renders as three separate keys rather
 * than one blob.
 */
function parts(value: string): string[] {
  return value.replace('Cmd', '⌘').replace('Ctrl', 'Ctrl').split('+')
}

export function ShortcutsWindow(): React.JSX.Element | null {
  const [bootstrap, setBootstrap] = useState<ShellBootstrap | undefined>(undefined)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const api = shellBridge()
    let active = true
    const apply = (value: unknown): void => {
      if (!active) return
      const next = value as ShellBootstrap
      setBootstrap(next)

      // The document-level chrome the bootstrap owns. All of it is localized, and
      // all of it lives here rather than in the render body because these are
      // properties of the DOCUMENT, not of the React tree: the window title and
      // `lang` sit outside the React root entirely.
      document.documentElement.lang = next.locale
      applyColorScheme(next.colorScheme)
      document.title = localize(next.locale, '键盘快捷键', 'Keyboard Shortcuts')
      // The search field is the reason this window opens: the user pressed a
      // shortcut to get here and wants to start typing immediately. Focusing on
      // every bootstrap (not just the first) matches the original, which called
      // `focus()` from its `applyBootstrap`.
      searchRef.current?.focus()
    }
    // Subscribe BEFORE requesting. The main process broadcasts on theme and locale
    // changes, and the reverse order can drop a broadcast that lands between the
    // request and the listener registration — see the note in `use-shell.ts`.
    const unsubscribe = api.onBootstrap(apply)
    void api.getBootstrap().then(apply, () => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Hold the first frame until the bootstrap arrives. Rendering a default-locale
  // frame first would visibly flip its copy a moment later; the window is already
  // painted in the theme's background color by the main process, so there is
  // nothing to fill the gap with.
  if (bootstrap === undefined) return null

  const needle = query.trim().toLowerCase()
  const matched = bootstrap.actions.filter(action =>
    action.acceleratorLabel !== undefined
    && `${action.label} ${action.keywords} ${action.acceleratorLabel}`.toLowerCase().includes(needle))

  // `menus` order is the section order; an empty group drops out here rather than
  // being filtered later, so "no matches at all" and "matches in no menu" are the
  // same condition, expressed once.
  const sections = bootstrap.menus
    .map(menu => ({ menu, rows: matched.filter(action => action.menu === menu.id) }))
    .filter(section => section.rows.length > 0)

  return (
    <main>
      <header>
        <h1 id="title">{localize(bootstrap.locale, '键盘快捷键', 'Keyboard Shortcuts')}</h1>
        {/*
          The caption-button component is deliberately NOT reused here: this
          window draws a single inline 30x30 close glyph in the header flow,
          whereas `WindowControls` is a three-button absolute strip sized for the
          40px title bar. What IS shared is the route out — the bridge, never
          `window.close()`, because the main process decides whether a window may
          close at all (`mayControlWindow` in shell-ipc-policy.ts).
        */}
        <button
          type="button"
          className="close"
          data-action="close-window"
          aria-label={localize(bootstrap.locale, '关闭', 'Close')}
          onClick={() => { void shellBridge().windowControl('close') }}
        >
          <img src="shell-icons/xmark.svg" alt="" />
        </button>
      </header>

      <label className="search">
        <img src="shell-icons/magnifying-glass.svg" alt="" />
        <input
          id="query"
          ref={searchRef}
          type="search"
          autoComplete="off"
          placeholder={localize(bootstrap.locale, '搜索快捷键', 'Search shortcuts')}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </label>

      <div id="list">
        {sections.map(section => (
          <section className="section" key={section.menu.id}>
            <h2>{section.menu.label}</h2>
            {section.rows.map(action => (
              <div className="row" key={action.id}>
                <span>{action.label}</span>
                {/* The keys are one unit: `flex: none` keeps a long accelerator
                    from being squeezed when the label beside it is long. */}
                <span className="keys">
                  {parts(action.acceleratorLabel!).map((key, index) => (
                    // The key is the index, not the text: `Ctrl+Shift+=` and a
                    // hypothetical `Ctrl+Shift+Ctrl` both need the position to be
                    // the identity, since the text itself can repeat.
                    <kbd key={index}>{key}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}

        {/* Shown only when the WHOLE list is empty — including the no-query case,
            which cannot happen in practice but is the same condition. */}
        {sections.length === 0
          ? <div className="empty">{localize(bootstrap.locale, '未找到匹配的快捷键', 'No matching shortcuts')}</div>
          : null}
      </div>
    </main>
  )
}
