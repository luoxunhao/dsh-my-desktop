/**
 * The About window.
 *
 * This is the React replacement for `assets/about.html`. It is a straight port:
 * the element order, the class names, the copy (zh + en) and the stylesheet
 * values all come from that file, so the two can be diffed by eye until the
 * hand-written original is deleted.
 *
 * WHY THE DOCUMENT IS AN INDEX, NOT A COMPONENT
 * ---------------------------------------------
 * `about.html` rendered exactly one frame and then patched it in place by id.
 * The React version keeps one `bootstrap` state and derives every string from
 * it, so a locale or theme broadcast re-renders the whole window in one pass
 * instead of mutating thirteen nodes in a fixed order.
 *
 * The bootstrap handshake is the shared one documented in `use-shell.ts` and
 * reproduced in `ShellBar.tsx`: subscribe (`onBootstrap`) BEFORE requesting
 * (`getBootstrap`). The reverse order can drop the broadcast that lands between
 * the two calls and leave the window on a stale locale or theme. The original
 * did have this race, in the opposite direction — but on this payload it was
 * harmless, because `locale`, `version`, `runtimeVersion` and `platform` never
 * change while the app runs. Only `colorScheme` can, and that is the one field
 * the order above actually protects.
 *
 * WHY `applyBootstrap` IS NOT A HOOK
 * ----------------------------------
 * The original's `applyBootstrap` wrote document-level things that are not
 * React's to own — `lang`, the color scheme and `title`. They are still applied
 * here, still together, still from the bootstrap, because a theme change must
 * reach the styles in `styles/about.css` and the native window title at the same
 * instant the rest of the window re-renders. `use-shell.ts` exposes hooks over
 * this bridge, but the bootstrap one keeps `lang` and `title` out of its scope,
 * so using it here would split one atomic operation across two effects.
 */

import { useEffect, useState } from 'react'

import { applyColorScheme, localize, shellBridge } from './api.js'
import type { ShellBootstrap } from './api.js'

/** Every localised string in the window, zh and en side by side. */
const TEXT = {
  title: { zh: '关于 DSH My Desktop', en: 'About DSH My Desktop' },
  tagline: { zh: '面向 DeepSeek Harness 的跨平台桌面客户端', en: 'A cross-platform desktop client for DeepSeek Harness' },
  desktopLabel: { zh: '桌面版本', en: 'Desktop version' },
  runtimeLabel: { zh: 'DSH 运行时', en: 'DSH runtime' },
  platformLabel: { zh: '运行平台', en: 'Platform' },
  aboutTitle: { zh: '关于这个项目', en: 'About this project' },
  aboutCopy: {
    zh: '把本地项目、会话、插件、自动化与智能体工作流集中在一个原生桌面窗口中，同时保留 DeepSeek Harness 的开放插件能力。',
    en: 'Bring local projects, chats, plugins, automations, and agent workflows into one native desktop window while preserving the open DeepSeek Harness plugin model.',
  },
  footer: { zh: 'MIT 开源许可 · DSH My Desktop 不存储你的模型凭据。', en: 'MIT licensed · DSH My Desktop does not store your model credentials.' },
  close: { zh: '关闭', en: 'Close' },
} as const

/**
 * The feature bullets, in order.
 *
 * Data rather than a list of `<li>`s, for the same reason `localize()` exists:
 * the launcher ships exactly two locales and every row carries both strings side
 * by side, which is what makes a missing translation visible in review. The
 * original had to build this list with `innerHTML` because it swapped the copy
 * at runtime; React escapes it by construction instead.
 *
 * `en` doubles as the React key — it is unique in this table and stable across a
 * locale change, unlike the array index.
 */
const FEATURES: readonly { readonly zh: string, readonly en: string }[] = [
  { zh: '按项目管理聊天和工作区', en: 'Project-based chats and workspaces' },
  { zh: '原生菜单、托盘、快捷键与安全重载', en: 'Native menus, tray, shortcuts, and safe reload' },
  { zh: '由 luoxunhao 维护的开源桌面应用', en: 'Open-source desktop app maintained by luoxunhao' },
]

export function AboutWindow(): React.JSX.Element | null {
  const [bootstrap, setBootstrap] = useState<ShellBootstrap | undefined>(undefined)

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
      document.title = localize(next.locale, TEXT.title.zh, TEXT.title.en)
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

  const locale = bootstrap.locale
  const title = localize(locale, TEXT.title.zh, TEXT.title.en)

  return (
    <>
      {/*
        The titlebar is the window's drag region (`-webkit-app-region: drag` in
        styles/about.css). Anything interactive inside it must opt back out with
        `no-drag`, which `.titlebar-close` does.
      */}
      <header className="titlebar">
        <span className="titlebar-title">{title}</span>

        {/*
          Close button — the one place this port deliberately does NOT reuse
          `<WindowControls>`.

          It exists in the original as a single caption button pinned right, and
          that shape is kept, because `WindowControls` renders all THREE buttons
          at Windows metrics. This window is fixed-size, `minimizable: false` and
          `maximizable: false` (dialog-service.ts), so a minimise and a maximise
          button would be dead controls, and the trio carries a `--titlebar-fg`
          glyph tuned for the bar's gradient rather than the white-on-red this
          window asks for.

          The ROUTE is the shared one, though: the same bridge command
          `WindowControls` sends, never `window.close()`. The main process decides
          whether a window may close at all (`mayControlWindow` in
          shell-ipc-policy.ts), and a renderer-side close would bypass it. The
          original's `window.close()` happened to work anyway — Electron maps it
          onto the window's own close path once `window.close` is denied — but it
          did so invisibly, and against every other window in the launcher.
        */}
        <button
          type="button"
          className="titlebar-close"
          aria-label={localize(locale, TEXT.close.zh, TEXT.close.en)}
          title={localize(locale, TEXT.close.zh, TEXT.close.en)}
          onClick={() => { void shellBridge().windowControl('close') }}
        >
          <img src="shell-icons/xmark.svg" alt="" />
        </button>
      </header>

      <main>
        <section className="hero">
          {/*
            `alt` carries the product name rather than being empty: this image IS
            the product identity in the hero, not decoration. The original did the
            same.
          */}
          <img className="icon" src="icon.png" alt="DSH My Desktop" />
          <div>
            <h1>DSH My Desktop</h1>
            <p className="tagline">{localize(locale, TEXT.tagline.zh, TEXT.tagline.en)}</p>
          </div>
        </section>

        <dl className="card meta">
          <dt>{localize(locale, TEXT.desktopLabel.zh, TEXT.desktopLabel.en)}</dt>
          {/* The `v` prefix belongs to the markup, not the payload: the app version
              arrives bare, while `runtimeVersion` already carries its own. */}
          <dd>v{bootstrap.version}</dd>
          <dt>{localize(locale, TEXT.runtimeLabel.zh, TEXT.runtimeLabel.en)}</dt>
          <dd>{bootstrap.runtimeVersion}</dd>
          <dt>{localize(locale, TEXT.platformLabel.zh, TEXT.platformLabel.en)}</dt>
          <dd>{bootstrap.platform}</dd>
        </dl>

        <section className="card">
          <h2>{localize(locale, TEXT.aboutTitle.zh, TEXT.aboutTitle.en)}</h2>
          <p className="copy">{localize(locale, TEXT.aboutCopy.zh, TEXT.aboutCopy.en)}</p>
          <ul>
            {FEATURES.map(feature => (
              <li key={feature.en}>{localize(locale, feature.zh, feature.en)}</li>
            ))}
          </ul>
        </section>

        <footer>{localize(locale, TEXT.footer.zh, TEXT.footer.en)}</footer>
      </main>
    </>
  )
}
