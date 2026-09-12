<div align="center">

# DSH My Desktop

**A native desktop launcher for DeepSeek Harness.**

[简体中文](README.zh-CN.md) · [Changelog](CHANGELOG.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> DSH My Desktop is a community-maintained desktop launcher for DeepSeek Harness. It is not an official DeepSeek AI product.

DSH My Desktop is an Electron application that launches a local
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) instance and
shows its web UI in a native desktop window. The installer carries its own
Node.js runtime and a self-contained DSH core runtime, so you can open the app
and use DSH without installing Node.js or starting it from a terminal.

## What this project actually is

DSH My Desktop is a **launcher and desktop shell**. It does not implement the
chat / workbench UI itself. What you see inside the window is the DSH core
(`@deepseek-ai/dsh`) plus any plugins you install into the active profile.

This version (0.4.0):

- bundles **five plugins** offline (`BUNDLED_PLUGINS`): the community plugins
  `dshmarket`, `dsh-better-sidebar`, `dsh-vision-router` and `dsh-context`, plus
  `dsh-codex-project` (Codex-style shared workspace subdirectories). All are staged
  into `store.tgz` at build time and seeded into the profile on first launch without
  any network access. `dsh-codex-project` ships as a **prebuilt, checksummed artifact**
  under `vendor/` rather than as source — see the CHANGELOG for why;
- ships a **built-in desktop settings page** (the `dsh-my-desktop-setting`
  plugin, source in `plugins/dsh-my-desktop-settings/`), injected at launch — see below;
- manages **multiple profiles**: list, create, delete and switch, with the
  selection persisted across restarts;
- starts the selected profile (`dsh-base` + `dsh-web-app`) on a validated
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
| DSH official core runtime (`@deepseek-ai/dsh` family, 0.1.5-rc.1) | Yes |
| Desktop settings plugin (`dsh-my-desktop-setting`) | Yes — built from this repo |
| Community plugins (`dshmarket`, `dsh-better-sidebar`, `dsh-vision-router`, `dsh-context`) | Yes — seeded offline from the packaged store |

The core runtime is preinstalled separately from the profile, so plugins you
install later do not overwrite the packaged runtime.

## Profiles

Profiles are managed objects, not a hardcoded directory:

- Each profile lives at `<DSH_HOME>/profiles/<name>/` (`~/.dsh/profiles/<name>`
  on Windows).
- **The default profile is `dsh-my-desktop`**: that is where the app lands when
  its registry is missing or unreadable, and where the four bundled community
  plugins are seeded.
- The active selection is stored in
  `%APPDATA%\DSH My Desktop\profile-registry.json` and falls back to
  `dsh-my-desktop` when missing or unreadable. That registry is the **only**
  input to profile resolution: an existing install that already recorded
  `"active": "web"` keeps using `web` rather than migrating to the new default —
  switch it from the settings page, or delete that registry file.
- You can create, delete and switch profiles from the built-in desktop settings
  page. Deleting moves the profile to the trash, and the active profile cannot
  be deleted.
- Switching a profile restarts the local DSH service; a newly created profile
  seeds itself on first boot, which takes a while (pnpm installs its deps).

## The built-in desktop settings page

The installer ships a private plugin, `dsh-my-desktop-setting`, whose source
lives in this repository under `plugins/dsh-my-desktop-settings/`. It is built and
packaged together with the launcher and registers a "Desktop Settings" section
in the DSH settings shell.

It is **not installed into any profile**. Instead, the launcher materializes it
into `%APPDATA%\DSH My Desktop\desktop-settings-plugin\` on every start and
injects it with a `--patch` overlay onto whichever profile is active. Two
consequences worth knowing:

- It follows you across profiles — switching profiles does not require
  reinstalling it.
- It is a launcher feature, not a profile dependency, so it never appears in a
  profile's `node_modules` or `dsh.profile.bundles`.

## First launch

On first launch the app prepares the default profile under
`~/.dsh/profiles/dsh-my-desktop` (`dsh-base` + `dsh-web-app`) and seeds the four
bundled community plugins into it **without any network access** — they ship
inside the installer as an offline store (`store.tgz`). The same seeding runs
when you create or switch to a profile that does not have them yet.

To add more plugins you install them yourself, for example with the DSH CLI
against this app's runtime:

```sh
dsh plugin --profile dsh-my-desktop add <package>
```

The bundled plugins are pinned to exact versions, so upgrades arrive by
shipping a new build of the app (or by updating them in-app through the market,
which writes the usual pending-update record).

## What the desktop shell provides

- A desktop window that loads the local DSH web UI.
- Profile management (create / delete / switch) from the desktop settings page.
- A bundled desktop settings page covering profile, market, AA, appearance,
  notifications and host actions (restart, terminal, developer tools).
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
# one-time: install dependencies (also links the in-repo plugin workspace)
pnpm install --frozen-lockfile

# assemble bundled node/pnpm + DSH core runtime, then produce installers
pnpm run dist
```

`pnpm run dist` builds the bundled plugin, then runs `prepare-runtime`
(assembles the bundled Node + pnpm and packs the official DSH core runtime
tarball), then electron-builder writes installers into `release\`.

The plugin and launcher build as one unit: every packaging path builds the
plugin first (`pnpm run build:all`), and packaging fails loudly if the plugin
artifacts are missing rather than silently shipping an installer without the
desktop settings page.

A local helper that uses a pinned Node 24.20.0 is available at
`scripts/build.ps1` (run with `pwsh`); `-Target dist-local` is the fast path
that reuses the already-assembled runtime instead of re-downloading it.

`prepare-runtime` downloads the official DSH runtime and any bundled plugins
from an npm registry. The registry defaults to the official
`https://registry.npmjs.org/`, but can be overridden with the
`DSH_BUILD_REGISTRY` environment variable — e.g. point it at a mirror
(`https://registry.npmmirror.com/`) when the default registry is slow or
unreachable:

```powershell
$env:DSH_BUILD_REGISTRY = 'https://registry.npmmirror.com/'
pnpm run dist
```

## Data and privacy

- DSH config, sessions and credentials live in the user's DSH directory
  (`~/.dsh` on Windows). Uninstalling the app does not delete them.
- The active-profile selection lives in the app's user data directory
  (`%APPDATA%\DSH My Desktop\profile-registry.json`).
- The launcher only loads validated `127.0.0.1` loopback HTTP addresses in its
  embedded window.
- External links open in the system browser. The DSH page runs with Electron
  context isolation and sandboxing, with Node.js integration disabled.
- Model providers and DSH tools you configure may make their own network
  requests.

## License

[MIT](LICENSE)
