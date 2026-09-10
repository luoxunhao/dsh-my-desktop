# Changelog

[简体中文](CHANGELOG.zh-CN.md)

## 0.1.3

The desktop settings plugin moved into this repository, and the launcher and
plugin now build as one unit.

- **Plugin source moved in-repo**: `dsh-my-desktop-setting` now lives in
  `plugins/dsh-my-desktop-settings/` as a pnpm workspace member, built and released
  together with the launcher (no longer published to npm on its own). Its
  planning and gap-analysis docs (`PLAN.md`, `DESIGN-align-dsh-desktop.md`)
  moved with it.
- **Unified build**: added `build:all` (plugin → launcher). Every packaging
  path (`dist`, `pack`, `start`, `dist:local`, `pack:local`) now builds the
  plugin. Previously only `dist:local` / `pack:local` did — `dist` / `pack`
  staged whatever artifacts happened to exist, and since plugin artifacts are
  gitignored, a fresh clone would **silently produce an installer with no
  desktop settings page**.
- **Packaging fails fast**: `stageDesktopSettingsPlugin()` now throws when the
  plugin artifacts are missing instead of warning and skipping.
- **No more version drift**: the materialized plugin manifest reads the
  plugin's own `package.json` version (falling back to the app version),
  where it used to be hardcoded to `0.1.0`.
- Added 5 tests covering these constraints (missing artifacts must fail,
  a missing client half must fail, all packaging scripts build the plugin via
  a recursive `pnpm run` chain walk, plus version resolution and fallback).

### 0.1.2 and earlier (never released separately; shipped with 0.1.3)

- **Multi-profile management**: profiles are no longer a hardcoded `web`
  directory. List, create, delete and switch, with the selection persisted to
  `profile-registry.json`. Switching restarts the service; deleting moves the
  profile to the trash, and the active profile cannot be deleted.
- **Built-in desktop settings page**: the bundled `dsh-my-desktop-setting`
  plugin (host + client) registers into the DSH settings shell's
  `settings.section` slot, with its UI and behaviour aligned to `dsh-desktop`.
  It is not installed into any profile — the launcher injects it with a
  `--patch` overlay onto the active profile on every start, so it follows you
  across profile switches.
- **Desktop bridge exposes ctx services**: `desktopProfiles` / `desktopPnpm` /
  `desktopRuntime`, registered on `ctx.root` (required by Cordis scope
  isolation), with child ↔ Electron main communication over `process.send`
  request/response IPC.
- **Profile operations no longer freeze the UI**: create/delete are reflected
  without a restart; the timeout differs by operation (creating a profile
  seeds it and can take tens of seconds) and never hangs the HTTP response.
- Fixed a re-created profile inheriting the previous one's delete-confirmation
  styling.
- Top bar restyled after `dsh-desktop`; the terminal can now run the `dsh` CLI
  (injected into that terminal process's PATH only, never the system PATH).
- Product name unified as **DSH My Desktop**; fixed the Start Menu shortcut
  icon being overwritten with `notification.ico` at install time.

## 0.1.0

Initial release of **DSH My Desktop**, a native Electron launcher for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This version is a launcher / desktop shell:

- It bundles **no community plugin** (`BUNDLED_PLUGINS` is empty) and
  preinstalls none.
- It ships the Electron desktop shell, a bundled Node.js + pnpm runtime, and
  the official DSH core runtime needed to boot a local `web` profile.
- Plugins are installed by the user at runtime (for example with
  `dsh plugin --profile web add <package>`, or by installing a market plugin
  such as `dshmarket` into the profile). Nothing is bundled in the installer.

What this version provides:

- A native desktop window (with tray, notifications, theme, zoom, window state).
- Boots a local DSH core on a validated `127.0.0.1` loopback address and keeps
  its web UI inside the desktop shell.
- A desktop bridge injected only when Desktop starts DSH; running `dsh web`
  manually uses the normal Web plugin path.
- Startup self-repair that strips invalid profile entries before booting DSH.

The chat / workbench UI you see is provided by DSH core and the plugins you
install into its `web` profile; this project does not implement that UI itself.

Release tag: [`v0.1.0`](https://github.com/luoxunhao/dsh-my-desktop/tree/v0.1.0).
