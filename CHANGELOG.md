# Changelog

[简体中文](CHANGELOG.zh-CN.md)

## 0.2.0

Version bump to 0.2.0. The bundled DSH runtime is 0.1.5-rc.1.

- **Version alignment**: root `package.json` and the bundled
  `dsh-my-desktop-setting` plugin both bumped to `0.2.0` (the materialized
  plugin manifest falls back to the app version, so they stay in lockstep).
- **Stale runtime reference fixed**: `config.bundledDshVersion` was still
  `0.1.2-rc.1`; corrected to the real `0.1.5-rc.1` (matching
  `OFFICIAL_DSH_VERSION` and the CHANGELOG/README docs).
- **Terminal `dsh` fixed**: the terminal shim imported the official CLI as a
  module, so 0.1.5's `if (import.meta.main) await runCli()` guard was false and
  `dsh --version` exited 0 with zero output. The shim now calls the exported
  `runCli()` explicitly (same fix as the launcher's own bootstrap).
- **Plugin market preinstalled from npm**: `dshmarket@1.45.1` is seeded into the
  active profile on first launch (and on profile create/switch) by downloading
  it from the npm registry — it is **not** packed into the installer and does
  not require an offline plugin store. Once installed it is written into the
  profile's `dependencies` and activated as a bundle, so it also upgrades like
  any other community plugin.
- TODO: fill in the 0.2.0 feature list here before release.

## 0.1.4

The recovery assistant was rebuilt as a first-class repair surface, aligned
panel-for-panel with dsh-desktop, and the bundled DSH runtime moved to
0.1.5-rc.1.

- **Recovery page rebuilt (1:1 with dsh-desktop)**: a single React app with six
  tabs — quick recovery (with Safe Mode), plugin management, rollback, Profile
  switching, reset & data management, and diagnostics. The previous page was five
  hand-rolled tabs with no data panel. All wording lives in a bilingual copy table
  (`recovery-copy.ts`) so parity with the reference stays diffable.
- **Health snapshots became user-visible**: the three-slot system existed since the
  checkpoint work but had no writer on any launch path. Healthy startups now capture
  a slot, and the rollback panel shows each slot's capture time, desktop version,
  plugin count, configuration-file count and size — plus "browse files" and
  "roll back to this slot".
- **Rollback works across profiles**: a slot records which profile it came from and
  can be restored INTO the current profile (the dsh-desktop model). The page shows
  the active profile's three slots; the profile is stated once, in the reason card.
- **Safe Mode is real**: entering it relaunches the app with a one-shot marker, the
  startup gate prepares a disposable DSH home (isolated from the user's data), and
  the page shows the active state. The same fix stops a normal restart from
  inheriting the recovery/safe-mode marker — restarting from recovery used to spin
  back into recovery forever.
- **Profile switching from recovery**: switch to another desktop-capable Profile,
  using the same guarded relaunch path.
- **Diagnostics bundle**: one-click export of the startup diagnostic, error log and
  profile manifest as a single text file, with "show in folder".
- **Data management**: the current DSH data directory is shown and can be changed or
  restored to default; factory reset (trash + recreate) sits behind its own card.
  Both run under a cross-process operation lock, so two data mutations can no longer
  interleave.
- **Recovery restart fixed**: the footer restart action now relaunches the whole
  application instead of calling "return to workbench", which always failed in a
  recovery session ("DSH 尚未成功启动").
- **Bundled DSH runtime → 0.1.5-rc.1**, with the four client packages re-vendored.
- Tests: 330 → 502 (the new coverage targets the silent-failure class: snapshot
  capture wiring, cross-profile restore, operation lock, IPC contract drift,
  restart semantics, and UI copy parity).

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
