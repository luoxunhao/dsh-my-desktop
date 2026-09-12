# Changelog

[简体中文](CHANGELOG.zh-CN.md)

## 0.4.0

Version bump to 0.4.0. The bundled DSH runtime is **unchanged** at 0.1.5-rc.1 — that
is still npm's `latest` tag for `@deepseek-ai/dsh` (matching the call made for 0.2.1
and 0.3.0).

- **`dsh-codex-project` is bundled** as the fifth preinstalled plugin (Codex-style
  shared subdirectories: a workspace plus extra writable roots across drives, all still
  under `workspace-write`). It ships as a **prebuilt artifact**, not as source:
  `vendor/dsh-codex-project/<name>-<version>.tgz` — the upstream package's own
  `pnpm pack` output, containing the built `lib/` — is committed, checksummed, and
  copied into the offline store by `prepare-runtime`. The seed then installs it from a
  `file:` spec. Nothing is built from this repo, and there is no second copy of the
  source to keep in sync.
  - This path exists because the version that supports this runtime (0.12.0, peer
    `^0.1.5-rc.1`) is **not published**: npm's latest is 0.11.0 from the
    `0.1.2-alpha` line, whose peer range `^0.1.0-rc.6` rejects `0.1.5-rc.x` (semver
    ranges do not match prereleases) and which upstream documents as unsupported.
  - The artifact is verified, not trusted: `stageVendorTarball` checks its SHA256 and
    reads the manifest **out of the archive** to confirm name and version, so a
    hand-swapped blob or a one-sided version bump fails the build instead of shipping.
  - **Fixed a bug that made the whole feature a no-op on a real install**: pnpm records
    its store as `<root>/v11`, and `resolvePnpmStoreDir` returned that verbatim, so the
    seed looked for the artifact under `<root>/v11/vendor-tarballs/…` while
    `prepare-runtime` had correctly written it to `<root>/vendor-tarballs/…`. The seed
    aborted with "artifact missing" and the plugin never appeared — even though it
    shipped correctly in the installer. `pnpmStoreRoot` now strips pnpm's layout
    directory, which is also what `--store-dir` expects (verified: passing the root
    makes pnpm record `<root>/v11`). Three existing tests had encoded the old behaviour
    as correct and were updated along with it.
  - It enters through the **profile-bundle** path rather than a `--patch` overlay
    because its bundle layer disables the core `fs-sandbox` row and mounts its own
    multi-root fs provider in that seat.
  - `koffi` (the Windows ACL runner's native half) was already in
    `ALLOWED_BUILD_PACKAGES`, which is what lets it build during staged assembly.
- **Two pre-existing store-assembly bugs fixed** (independent of the plugin above): a
  stale `staging/` manifest from an aborted run was reused as the dependency set for
  the next build, and registry plugins were staged as `name@version` dependency
  *values*, which pnpm parses as an npm alias and rejects with
  `SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`.
- **`--stage-plugin` now assembles the plugin store.** It previously staged only the
  settings plugin, so the fast `dist:local` / `pack:local` path shipped a `store.tgz`
  that silently stayed at whatever the last full build produced.
- **`scripts/stage-installed.ps1` now syncs `plugins-store.tgz`** (and its checksum,
  clearing the extracted tree so the next launch re-extracts). It previously staged
  the app and bridge but not the store, so an incremental stage into the installed
  app left the preinstalled plugin set stale — a change that looked applied but was
  not.

## 0.3.0

Version bump to 0.3.0. The bundled DSH runtime is **unchanged** at 0.1.5-rc.1 — that is
still npm's `latest` tag for `@deepseek-ai/dsh` (`next` is 0.1.5-rc.2, deliberately not
taken, matching the call made for 0.2.1).

- **Bundled community plugins went from one to four**: `BUNDLED_PLUGINS` gained
  `dsh-better-sidebar@0.19.1` (a VS Code-like right sidebar),
  `dsh-vision-router@2.1.6` (vision plus pixel-level tools for text-only models) and
  `dsh-context@0.50.0` (context dashboard and management). `dshmarket@1.45.1` already
  shipped (see the 0.2.1 section) and is untouched here. All four are staged into the
  offline store at build time and seeded into the profile on first launch /
  profile create-or-switch with **no network access**, so users install nothing by hand.
- **Assembly verified end to end**: 276 packages; `node-pty` builds its native half
  under the existing `ALLOWED_BUILD_PACKAGES` allowlist, so no build-script restriction
  had to be widened.
- **Cost: `store.tgz` grows from 1.9 MB to ~110 MB** (compressed), which is the main
  price of this change. The four plugins' own code is only ~27 MB; the rest is shared
  dependencies (the CodeMirror family, mermaid, puppeteer-core, …) and cached registry
  metadata. Plugin upgrades still require a new build.
- **Docs corrected**: the README (en + zh-CN) claims that no community plugin
  (`BUNDLED_PLUGINS` empty) and no plugin market were bundled had already been untrue
  since 0.2.1 (`dshmarket` shipped then). They now match the code, and the stated
  version moved from the stale 0.1.3 / 0.2.1 to this release.

## 0.2.1

Version bump to 0.2.1. The bundled DSH runtime is unchanged at 0.1.5-rc.1.

This is the first tree that actually carries version `0.2.1`: the `0.2.0` tag was
cut before the version bump landed (see the note at the end of the 0.2.0 section),
so the changes below reached no tag until now.

- **Version alignment**: root `package.json` and the bundled
  `dsh-my-desktop-setting` plugin both bumped to `0.2.1` (the materialized plugin
  manifest falls back to the app version, so they stay in lockstep). This also
  completes the correction started in 0.2.0: `config.bundledDshVersion` had still
  read `0.1.2-rc.1` and now matches `OFFICIAL_DSH_VERSION` (`0.1.5-rc.1`) as well
  as the README docs.
- **Terminal `dsh` fixed**: the terminal shim imported the official CLI as a
  module, so 0.1.5's `if (import.meta.main) await runCli()` guard was false and
  `dsh --version` exited 0 with zero output — the same root cause as the 0.2.0
  startup hang, in the terminal shim instead of the bootstrap.
- **Plugin market preinstalled offline**: `dshmarket@1.45.1` ships inside the
  installer as an offline pnpm store (`plugins-store.tgz`) and is seeded into the
  active profile on first launch (and on profile create/switch) **without network
  access**. Enabling the store reconnected machinery that already existed:
  `prepare-runtime` assembles `store.tgz`, `extraResources` ships it, and the
  runtime extraction step unpacks it to `plugins/store`. Plugin upgrades now
  require a new build; the installer grows by ~1.8 MB (compressed store).
- **Closing the About window no longer breaks the app**: `preventWindowsOwnedWindowFlash`
  detached the parent window on `close` to avoid the Windows owner-flash, but Electron
  refuses `setParentWindow` on a **modal** window ("Can not be called for modal window").
  The throw happened inside the `close` handler, so the window still closed — the
  exception then reached `process.on('uncaughtException')`, which the launcher treats as
  a startup failure and answers by replacing the main window with the "启动失败" page.
  Modal windows are now skipped, and they never needed the workaround (the OS keeps them
  in front of their owner, so there is no window to flash behind them).
- **Light theme now reaches the title bar**: `bar.css` keys every light-mode rule off
  `:root[data-color-scheme="light"]`, but nothing ever set that attribute on the shell
  window — `shell.html` had no pre-paint theme script and `ShellBar` did not apply the
  bootstrap scheme either, so the bar fell through to its dark defaults while the content
  below turned light. Both halves are now in place: the document script for the initial
  paint and `applyColorScheme` for live theme switches.
- **Recovery page follows the theme in both directions**: the same missing attribute made
  `styles.css` fall back to its LIGHT branch, so the page rendered light even in dark
  mode — the exact inverse of the title-bar bug. `?theme=` is now applied before first
  paint (CSP relaxed to `script-src 'unsafe-inline'` accordingly).
- **Shell windows migrated to Vite + React**: the five hand-written documents
  (`assets/{shell,about,shortcuts,settings,startup}.html`) are now React apps. Because
  the windows load over `file://` each bundle must be a classic script, and Vite 8
  (Rolldown) rejects IIFE with multiple inputs — so a new `scripts/build-shell-ui.mjs`
  builds them one at a time. The caption buttons are now renderer-drawn, removing the
  seam the native `titleBarOverlay` created (it can only paint a solid color).
- **UI sources consolidated under `frontend/`**: `src/shell-ui` → `frontend/shell` and
  `src/recovery-ui` → `frontend/recovery`, with build output at
  `dist/frontend/{shell,recovery}` and packaged output at
  `resources/frontend/{shell,recovery}`.
- **`stage-installed.ps1` fixed**: it only synced `app.asar`, but the shell documents and
  the recovery page resolve from `process.resourcesPath/frontend/` first — so staging
  silently left the running app on old HTML. It now syncs those directories and removes
  the pre-rename copies.
- **`.gitignore` anchored**: the unanchored `runtime/` rule matched `src/runtime/` at any
  depth, so new files there would have been silently ignored. The build-output rules now
  carry a leading slash.
- **`plugins/dsh-market/` removed**: it was an upstream reference clone (with its own
  `.git`) that the build never used — preinstall goes through npm's `dshmarket@1.45.1`.
  Left unignored it would have been committed as a bare gitlink, leaving clones with an
  empty directory.
- **Bundled community plugins grew to four**: `BUNDLED_PLUGINS` gained
  `dsh-better-sidebar@0.19.1`, `dsh-vision-router@2.1.6` and `dsh-context@0.50.0`
  (`dshmarket@1.45.1` already shipped via the 0.2.0 work). All four are staged into the
  offline store at build time and seeded into the profile on first launch / profile
  create-or-switch with **no network access**. Assembly was verified end to end:
  276 packages, and `node-pty` builds its native half under the existing
  `ALLOWED_BUILD_PACKAGES` allowlist — no widening needed. The four plugins' own code is
  ~27 MB, but `store.tgz` grows to ~110 MB because of shared dependencies and cached
  registry metadata; installer size is the main cost of this change. The README claims
  that no community plugin and no plugin market were bundled are now corrected.

## 0.2.0

The bundled DSH runtime moved to 0.1.5-rc.1 and startup stopped deadlocking on it.

All three fixes below repair the same regression class introduced by that runtime
upgrade: the launcher and the runtime had drifted apart in ways that produced a
**silent hang** rather than an error.

- **Startup no longer hangs on 0.1.5** (`fix(runtime)`): after the 0.1.5-rc.1
  upgrade the launcher stalled on "server-starting" until the 45-second timeout.
  0.1.5 added a main-module guard to the CLI (`if (import.meta.main) await
  runCli()`), but the bootstrap loads `bin.js` via `import()`, so
  `import.meta.main` was `false` and `runCli()` never ran — the process stayed
  alive with zero output and never listened. The bootstrap now invokes the CLI
  through the path that actually executes. Diagnosed by bisecting against a
  direct `bin.js` run (listened in 20s) versus the bootstrap (fully silent).
- **Bundle check and runtime resolution agreed on one directory**
  (`fix(runtime)`): `resolveDshRuntime` and `assertOfficialProfileBundlesAvailable`
  each computed the runtime directory independently, so in dev the first found a
  healthy `runtime-dsh/` while the second inspected a stale, partially-unpacked
  `userData\dsh-runtime`. The result was a nonsensical "missing bundled plugin
  dsh-base" error for a runtime that was present and correct.
- **Dev startup finds the workspace runtime** (`fix(runtime)`): the dev candidate
  chain (`DSH_RUNTIME_ROOT` → `resources\dsh` → `..\deepseek-harness`) could not
  reach the complete `runtime-dsh/` that `prepare-runtime` had just assembled, so
  a damaged `userData` unpack meant a hard error in dev while the packaged build
  self-healed. `<appPath>/runtime-dsh` is now a dev-only candidate, with no effect
  on packaged resolution.

> **Note on the `0.2.0` tag**: it points at `303e498`, i.e. the three runtime
> fixes above. The version bump and the items now listed under 0.2.1 landed
> afterwards, so the tagged tree still reports version `0.1.4` in
> `package.json`. The 0.2.1 section below is what actually carries `0.2.1`.

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
