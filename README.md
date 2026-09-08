<div align="center">

# DSH Desktop

**A native desktop launcher for DeepSeek Harness.**

[简体中文](README.zh-CN.md) · [Changelog](CHANGELOG.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> DSH Desktop is a community-maintained desktop launcher for DeepSeek Harness. It is not an official DeepSeek AI product.

DSH Desktop is an Electron application that launches a local
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) instance and
shows its web UI in a native desktop window. The installer carries its own
Node.js runtime and a self-contained DSH core runtime, so you can open the app
and use DSH without installing Node.js or starting it from a terminal.

## What this project actually is

DSH Desktop is a **launcher and desktop shell**. It does not implement the
chat / workbench UI itself. What you see inside the window is the DSH core
(`@deepseek-ai/dsh`) plus any plugins you install into its `web` profile.

This version (0.1.0):

- bundles no community plugin by default (`BUNDLED_PLUGINS` is empty);
- starts DSH's local `web` profile (`dsh-base` + `dsh-web-app`) on a validated
  `127.0.0.1` loopback address and keeps the web UI inside the Electron window;
- provides a desktop shell around it: window/tray, notifications, theme,
  zoom, settings window, and an update checker.

## Platform status

| Platform | Status |
| --- | --- |
| Windows x64 | Built and run locally (NSIS installer + portable zip) |
| macOS / Linux | Build targets are configured (dmg/zip, AppImage/deb), but not built or verified in this project yet |

Only Windows x64 has actually been packaged and run here.

## What is bundled vs not

| Component | Bundled? |
| --- | --- |
| Electron desktop shell | Yes |
| Node.js runtime + pnpm | Yes |
| DSH official core runtime (`@deepseek-ai/dsh` family, 0.1.2-rc.1) | Yes |
| Community / third-party DSH plugins | No |

The core runtime is preinstalled separately from the profile, so plugins you
install later do not overwrite the packaged runtime.

## First launch

On first launch the app prepares the official `web` profile under
`~/.dsh/profiles/web`. It does **not** preinstall any community plugin.

To add plugins later you install them yourself, for example with the DSH CLI
against this app's runtime:

```sh
dsh plugin --profile web add <package>
```

A plugin market is **not** bundled. If you want a market UI inside the app, you
install a market plugin (such as `dshmarket`) into the profile yourself; the
app exposes an install channel to plugins that need it, but no market is shipped.

## What the desktop shell provides

- A desktop window that loads the local DSH web UI.
- Tray icon with a reload action (restarts the local DSH service).
- Desktop notifications, theme handling, zoom, and window-state handling.
- A settings window and an update checker (checks for a new release after
  startup).
- Startup self-repair: the app strips invalid bundle entries from the profile
  and retries before booting DSH.

Everything else you see in the UI (chat, projects, model/provider selection,
skills, MCP, etc.) is provided by DSH core or by plugins you enable in the
profile — not by this launcher.

## Build from source

Requires Node.js `24.20.0` (the bundled runtime is validated against it) and
pnpm.

```powershell
# one-time: install dependencies
pnpm install --frozen-lockfile

# assemble bundled node/pnpm + DSH core runtime, then produce installers
pnpm run dist
```

`pnpm run dist` runs `prepare-runtime` (assembles the bundled Node + pnpm and
packs the official DSH core runtime tarball) and then electron-builder writes
installers into `release\`. A local helper that uses a pinned Node 24.20.0 is
available at `scripts/build.ps1` (run with `pwsh`).

## Data and privacy

- DSH config, sessions and credentials live in the user's DSH directory
  (`~/.dsh` on Windows). Uninstalling the app does not delete them.
- The launcher only loads validated `127.0.0.1` loopback HTTP addresses in its
  embedded window.
- External links open in the system browser. The DSH page runs with Electron
  context isolation and sandboxing, with Node.js integration disabled.
- Model providers and DSH tools you configure may make their own network
  requests.

## License

[MIT](LICENSE)
