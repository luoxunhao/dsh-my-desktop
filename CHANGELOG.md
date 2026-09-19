# Changelog

[简体中文](CHANGELOG.zh-CN.md)

## 0.8.2

**Experimental browser use now ships bundled and is mounted by default**, so the model can
drive a real Chromium tab in any profile without the user installing anything.

- **`@luoxunhao/dsh-codex-project` ships as 0.13.0** (was 0.12.0). From 0.13.0 its "project
  folder" and "file preview" tabs mount DSH's **native** right sidebar; 0.12.0 only had the
  `dsh-better-sidebar` fallback line, and since 0.8.1 stopped preinstalling that plugin the
  old artifact registered nothing at all. Ships as a prebuilt, checksummed vendor artifact.
- **Two official family packages join the bundled runtime.**
  `@deepseek-ai/dsh-browser-use` (the exclusive `browserUse` provider slot) and
  `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp` (Chromium tools via the pinned
  `@playwright/mcp`) are now part of `officialRuntimeDependencies()`, pinned to the same
  exact family version as the rest of the official set.
- **They deliberately do NOT go into `BUNDLED_PLUGINS`.** Both are `@deepseek-ai/dsh-*`, and
  `reconcileProfileBundles` skips official-scoped names, so a copy installed into a profile
  is never recorded in `dsh.profile.bundles` — and the startup plugin reconciliation then
  drops it as an undeclared package. Reproduced: the packages disappeared from a profile on
  the next start, while the same files sat untouched while the app was running. Shipping
  them inside the runtime directory avoids that path entirely, and a bare package name still
  resolves there.
- **Enabled by a launcher overlay rather than by user config.** The upstream provider is
  documented as "only enabled after an explicit mount", so bundling the code alone changes
  nothing. The launcher now materializes `browser-use.patch.yml` under userData and passes it
  as a third `--patch` alongside the desktop bridge and settings overlays, mounting both
  rows with `mode: launch` and `headless: true`. Because it rides the overlay channel, no
  profile's own `cordis.patch.yml` is touched, and switching or creating a profile needs no
  reinstall. `DSH_DISABLE_BROWSER_USE=1` skips the mount.
- **The browser binary comes from the system, not from the installer.** The provider builds
  its child environment by keeping only `PLAYWRIGHT_MCP_*` keys — blanked — so
  `PLAYWRIGHT_BROWSERS_PATH` never reaches Playwright, and `executablePath` (→
  `--executable-path`) is the only channel available. The launcher probes for an installed
  Chrome, then Edge, and passes its path; when neither is found the field is omitted and
  Playwright's own per-user discovery applies. Bundling Chromium was measured and rejected:
  271 MB for the headless shell and 433 MB for full Chromium, uncompressed.
- **Startup fails loudly rather than silently** if the assembled runtime is missing these
  packages: the freshness check reads the same dependency map, so a stale
  `runtime-dsh`/`runtime-dsh.tgz` no longer counts as current.

## 0.8.1

Patch release. **`dsh-better-sidebar` is no longer bundled**, taking the bundled community
plugins from six down to five.

- **`dsh-better-sidebar` drops out of the bundle.** `dsh-better-sidebar@0.19.1` (a VS
  Code-like right sidebar) is removed from `BUNDLED_PLUGINS`. New installs — and new or
  switched profiles — no longer seed it automatically, and its contribution to `store.tgz`
  is gone, so builds are faster and the installer smaller.
- **This is "no longer preinstalled", not "uninstalled".** The seed path
  (`plugin-seed`) only installs what is missing; it never removes. Profiles that already
  have the plugin are therefore untouched — it stays in their `node_modules` and remains a
  working bundle rather than being silently stripped on upgrade. Users who want the
  sidebar keep their existing install, or can reinstall it from the plugin market.

## 0.8.0

Release. The bundled DSH runtime moves to 0.1.6-alpha.2 (from 0.1.5-rc.2).

- **Bundled DSH runtime → 0.1.6-alpha.2.** The official family stays locked to one exact
  version: `OFFICIAL_DSH_VERSION` and `@deepseek-ai/dsh-scope` / `dsh-timeout` /
  `dsh-invariants` all move 0.1.5-rc.2 → 0.1.6-alpha.2, with `config.bundledDshVersion`
  following. Why this target rather than npm `latest`: every package in the family still
  points `latest` (and `next`) at 0.1.5-rc.2, and only the `alpha` dist-tag carries
  0.1.6-alpha.2 — so this is a deliberate move onto the alpha line, taken as one family,
  not a "follow latest" bump. `@deepseek-ai/cordis-plugin-group` stays pinned at its own
  1.0.2 (it has no alpha line and is not part of the family lock).
  The `dsh-my-desktop-setting` plugin's four client-type tarballs (locale / ui-renderer /
  ui-settings / ui-slots) are re-vendored under `vendor/0.1.6-alpha.2/` and `pnpm-lock.yaml`
  updated; the alpha client contract remained compatible with the rc line in practice —
  plugin `check:plugin` and launcher `check:all` both exit 0 with no plugin source changes.

## 0.7.0

Feature release. The bundled DSH runtime moves to 0.1.5-rc.2 (from 0.1.5-rc.1).

- **Bundled DSH runtime → 0.1.5-rc.2.** The official family stays locked to one exact
  version: `OFFICIAL_DSH_VERSION` and `@deepseek-ai/dsh-scope` / `dsh-timeout` /
  `dsh-invariants` all move 0.1.5-rc.1 → 0.1.5-rc.2, with `config.bundledDshVersion`
  following. Why rc.2 and not each peer's npm `latest`: those three packages have
  `latest` stuck at the ancient 0.0.1-rc.1, with only `next` at 0.1.5-rc.2 — installing
  each at its own `latest` would downgrade the peers and break the family version lock.
  The `dsh-my-desktop-setting` plugin's four client-type tarballs (locale / ui-renderer /
  ui-settings / ui-slots) are re-vendored under `vendor/0.1.5-rc.2/` and `pnpm-lock.yaml`
  updated; the rc.2 client contract proved compatible with rc.1 in practice — plugin
  `check:plugin` and launcher `check:all` both exit 0 with no plugin source changes.

- **"Desktop appearance and behavior" is removed entirely.** Three of the four controls in
  that panel were switches that did nothing: the compatibility / extended / enhanced mode
  radios have **zero consumers** on the launcher side (`appearance-preference.ts` states
  PRESENTATION MODE IS DELIBERATELY NOT READ, and a search of `src/` finds `mode` only in
  that comment); "Transparent" is explicitly not implemented in `resolveWindowMaterial`,
  which returns no options at all; "No Window Material" is the default. The only option
  that really worked, Mica, affects just the top 40px control bar (`SHELL_BAR_HEIGHT`),
  needs a restart, and requires Windows 11 22H2 or later. Wiring Mica up in 0.6.0 is
  exactly what exposed the shape of the problem: three of four clicks must do nothing, and
  the user cannot tell "the setting did not apply" from "I picked the wrong one". Removed
  wholesale by decision, rather than adding the three layouts / implementing `transparent`
  — which would have added two working switches to one dead one. The removal covers the
  contract (`SettingsAppearanceView` / `SettingsAppearanceUpdateRequest` / the
  `appearance.preference` token / the `appearanceUpdate` endpoint), the plugin's host and
  client implementations, the launcher-side material chain (`window-material.ts` /
  `appearance-preference.ts` / `bar.css`'s `data-window-material` rules / `shell.html`'s
  material bootstrap) and the related tests. `state.json` drops the `appearance` field
  while `STATE_VERSION` stays 1 — the legacy key is ignored as unknown, so an existing
  profile file stays valid.
- **Packaging no longer re-downloads the whole bundled-plugin dependency set
  (7-9 min → 96 s).** The cause was not pnpm: `main()` in `prepare-runtime` deleted the
  entire `runtime-plugins/` tree, and pnpm's content-addressable store (`store/v11`,
  404MB) plus metadata cache (`store/cache`) live underneath it — deleting them forces a
  310-package re-download on every install, on top of an official registry measured at
  18-34 KiB/s from here (hence the 4m17 / 9m40 / 7m36 runs; the log evidence being
  `reused 0, downloaded 310`). Wiping `runtime-plugins/` now keeps those two caches and
  removes only derived artifacts, while `store.tgz` is still repacked from a fresh
  install every run (the "a changed plugin list must rebuild the store" guarantee is
  unchanged); the install gains `--prefer-offline`; `DSH_FORCE_RUNTIME_REBUILD=1` wipes the
  caches too. `build.ps1` now defaults `DSH_BUILD_REGISTRY` to npmmirror when unset.
  Measured: `pnpm run prepare-runtime` (including `build:all`) in 96 s, logging
  `reused 310 / downloaded 0`.
- The `dsh-my-desktop-setting` plugin is bumped to 0.7.0 in step (the versioned overlay
  takes the highest SemVer, so an already-installed older copy cannot shadow the new
  logic).

## 0.6.0

Feature release. The bundled DSH runtime is **unchanged** at 0.1.5-rc.1.

- **The "Desktop appearance and behavior" window material now takes effect.** The
  material saved by the settings page used to be a dangling preference: the plugin
  wrote it into its own state file and the launcher never read it, so choosing Mica
  and choosing "No Window Material" made no difference to the window. The launcher
  now reads that preference before creating the first window and applies it to the
  `BrowserWindow` (Mica / acrylic), with the title bar turning into translucent
  glass. Notes:
  - `off` (the default) produces **no** window options — a profile that has never
    opened this setting yields window options byte-identical to before, so existing
    users see no change.
  - A material is a **creation-time property** of the window, so a change lands on
    the next start. The DSH content area is the official client's own document and
    stays opaque, so the material reads as a glass title bar rather than a fully
    immersive window treatment.
  - On non-Windows platforms (and older Windows without the system material API) it
    is not applied at all: the preference is kept, the window is unchanged.
- **Saving an appearance preference now honestly offers a restart.** `appearance/update`
  used to answer a bare `{accepted:true}` — nothing happened after saving, while the
  copy had always promised to ask whether to restart now. The endpoint now returns
  `DesktopRestartAcceptance` (`restartRequired` is true only when the value changed
  and a native host can apply it), the page shows a "takes effect after restart"
  banner, and the host actions (restart / terminal / DevTools) are no longer frozen
  by that banner, so the page's only restart affordance stays clickable.
- **"Browser and local network" is removed.** It never existed as a feature: the page
  never rendered it and the launcher contains no LAN/HTTPS code at all — what remained
  was 21 pairs of dead copy, an unconsumed capability token (`host.web-and-material`,
  whose manifest entry was self-contradictory: `supported` true while still reporting
  an `unsupportedCode`) and CSS that was never rendered. Removed wholesale, with the
  three verbatim-duplicated token exclusion lists collapsed into a single contract
  alias, `SettingsEmptyActionToken`.
- The `dsh-my-desktop-setting` plugin is bumped to 0.6.0 in lockstep (the versioned
  overlay picks the highest SemVer, so an older installed copy cannot shadow the new
  logic).

## 0.5.1

Patch release. The bundled DSH runtime is **unchanged** at 0.1.5-rc.1.

- **Fixed the flat-publish build failure.** Adding
  `src/profiles/market-preference.ts` in 0.5.0 made `plugin-seed.ts` import it, but
  the three bridge manifests that must stay in lockstep were never updated, so
  `stage-flat-units` hard-failed mid-build with
  `扁平发布单元 dist/bridge-flat 缺少依赖：plugin-seed.js 引用了 ./market-preference.js`.
  The three lists are:
  1. `scripts/stage-flat-units.ts` → `BRIDGE_LAYERS` (what gets flattened)
  2. `src/bridge/desktop-host.ts` → `DESKTOP_BRIDGE_FILES` (what gets copied into the installer)
  3. `package.json` → `build.extraResources` (electron-builder publishes each entry
     individually, **not** via a glob)

  All three now list 16 files. The guard in `stage-flat-units` is deliberate — it
  surfaces "imports that would only explode at run time" at build time instead.

- **Plugin market selection now takes effect, and Agents-Anywhere is gone** (this
  work landed in 0.5.0's tree but had not been released on its own). The market
  toggle is a real load/unload now rather than a dangling preference: with the market
  disabled, `dshmarket` is removed from the profile's `dependencies` and
  `dsh.profile.bundles` instead of being silently re-seeded into every profile. The
  launcher reads the plugin's state file directly, defaulting to `disabled` whenever
  the file is missing, unreadable, corrupt, or names an unknown provider.

- **Installing a plugin no longer restarts the desktop** — reload is only triggered
  explicitly by the user.

## 0.5.0

Version bump to 0.5.0. The bundled DSH runtime is **unchanged** at 0.1.5-rc.1 — that
is still npm's `latest` tag for `@deepseek-ai/dsh` (matching the call made for 0.2.1,
0.3.0 and 0.4.0).

- **`dsh-quote` is bundled** as the sixth preinstalled plugin: select a block of text
  in the conversation and "add to conversation" — it rides as one-shot injected context
  on your next real user message without entering the message text. Source:
  <https://github.com/luoxunhao/dsh-quote>.
  - Like `dsh-codex-project`, it ships as a **prebuilt, checksummed artifact** under
    `vendor/dsh-quote/`, because the version that fits this runtime (0.1.0) is **not
    published** — npm only has 0.0.1.
  - Its own peer declarations still name the `0.1.2-alpha` line rather than
    `^0.1.5-rc.1`. That turned out to be harmless **here**, and the reason is worth
    recording: it really only imports `@deepseek-ai/dsh-llm` at runtime, so it does not
    touch the host service surface that changed. Verified the same way as any bundled
    plugin — installed into a scratch profile, booted against DSH 0.1.5-rc.2, and
    asserted the host row reaches state 2 with the client bundle in the roster and no
    fibre error. If it is ever rebuilt against a newer surface, re-run that check rather
    than trusting the peer range.
  - Unlike `dsh-codex-project` its patch layer is a plain single `insert` — it does not
    disable or replace any core row, so nothing about the fs provider changes.

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
