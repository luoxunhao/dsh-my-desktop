# dsh-my-desktop-setting — Full Rework Research Map

Read-only mapping of the plugin (`dsh-my-desktop-setting`) and the launcher
(`dsh-my-desktop`) that injects it. Goal: know exactly what to rewrite/add to
reach feature/UI parity with a native-coupling design, and how the result is
built and injected into the running app. All line numbers are `file:line`.

---

## 1. Plugin current structure & purpose — `E:\project\dsh\dsh-my-desktop-setting\src\`

Build emits to `lib/` (`lib/index.js` host, `lib/client.js` browser, `lib/types/*.d.ts`).
Declared purpose (README.md:3-7, package.json:4): a host+client settings plugin that
registers into the official Settings shell's `settings.section` and persists its own
preferences; it is **host-agnostic** — Electron-only rows are capability-gated and
decline rather than fake success.

### src/contract.ts — shared wire contract (host + client source of truth)
- `API_BASE_PATH = '/api/dsh-my-settings'` (contract.ts:19). Distinct from the Desktop shell
  bridge's `/api/desktop/*` so routes can't collide (contract.ts:7-9).
- Types (contract.ts:21-200): `SettingsMarketProvider` (`'disabled'|'community-market'|'dsh-market'`),
  `SettingsCapabilityToken` (11 tokens, contract.ts:29-51: `profile.discover`, `market.preference`,
  `aa.preference`, `notifications.preference`, `appearance.preference`, `host.profile-switch`,
  `host.restart`, `host.open-terminal`, `host.devtools`, `host.diagnostics-export`, `host.web-and-material`),
  `SettingsProfileView`, `SettingsNotificationsView`, `SettingsAppearanceView` (material
  `off|mica|acrylic|transparent`, mode `compatibility|extended|advanced`), `SettingsCapabilityView`,
  `SettingsHostIdentityView`, `DesktopSettingsView` (the read projection),
  `DesktopRestartAcceptance`, `SettingsErrorResponse`, plus per-write request bodies.
- `settingsPaths` frozen map (contract.ts:179-200): `state`, `marketSelect`, `aaSelect`,
  `notificationsUpdate`, `appearanceUpdate`, `profileSwitch`, `restart`, `terminalOpen`,
  `devtoolsToggle`, `diagnosticsExport` under the base.

### src/host-capability.ts — capability detection/projection (pure)
- `HostServiceAccess` (host-capability.ts:35-48): the duck-typed probe result:
  `desktopEnv` (`DSH_DESKTOP_HOST==='1'`), `desktopProfiles?{connected}`, `desktopPnpm?{connected}`,
  `desktopRuntime: unknown|null`, `profileName`, `hasProfileDirectory`.
- `HostBridgeState` (`unavailable|offline|ready`), `HostCapability`, `SettingsLoadedView`.
- `detectHostCapability(access)` (host-capability.ts:86-118): builds `desktopHost`, bridge states,
  `runtimePresent`, profiles list, appearance.
- `effectiveAppearance()` (host-capability.ts:125-133): pure projection always `material:'off',
  mode:'compatibility', nativeCapable:false` (overwritten later by real capability).
- Helpers `marketChangeSupported` (pnpmBridge==='ready'), `nativeAppearanceSupported` (runtimePresent),
  `resolveAppearance`, `capabilityManifest`, `findCapability`, `inferLauncherSupport`
  (default all Host-专属 = runtimePresent), `defaultMarketProvider`.

### src/state-store.ts — plugin-owned JSON persistence
- `SettingsStateV1` shape: `{version:1, market:{provider}, aa:{enabled}, notifications{enabled+4 events},
  appearance{material,mode,nativeCapable}}` (state-store.ts:39-45).
- `resolveStateFilePaths(env)` (state-store.ts:68-90) — path resolution priority:
  1. `DSH_MY_SETTINGS_STATE_DIR` override → `<dir>/state.json`;
  2. `DSH_PROFILE_DIR` (absolute) → `<DSH_PROFILE_DIR>/.dsh-my-settings/state.json`;
  3. `DSH_HOME`(absolute)+`DSH_PROFILE_NAME` → `<DSH_HOME>/profiles/<name>/.dsh-my-settings/state.json`;
  4. else `{directory:null, filePath:null}` (persistence unavailable).
- `defaultState()` (state-store.ts:128-136): market `'disabled'`, aa `false`, notifications all-on,
  appearance off/compatibility. `MAX_STATE_BYTES = 64KB`, atomic write (temp+rename),
  size/shape guard, serialized write tail (state-store.ts:190-275).

### src/host-controller.ts — assembles read view, validates+persists writes, performs host actions
- `DesktopSettingsController` (host-controller.ts:62-296): holds `SettingsStateStore` + `HostCapability`
  + `HostActionPorts`. `read()` (122-159) builds the full `DesktopSettingsView` with
  `capabilities()`, `bridgeNames()`.
- `HostActionPorts` (host-controller.ts:39-45): optional `requestRestart/openTerminal/
  toggleDeveloperTools/exportDiagnostics` forwarders. `launcherSupport()` (83-91):
  each true iff a matching port fn exists; **profileSwitch is hardcoded false** (89).
- Writes: `selectMarket` (170-182, flags `restartRequired = changed && marketChangeSupported`),
  `selectAa` (185-191, restartRequired when changed), `updateNotifications` (194-210, no restart),
  `updateAppearance` (213-224, no restart, nativeCapable=false).
- `performHostAction` (230-282): switch dispatch; when no port → `{ok:false, code:
  'host.unsupported'|'host.offline'}` (never throws/fakes). `host.profile-switch` deliberately
  returns unsupported (274-278).
- Body parsers `parseMarketSelect/parseAaSelect/parseNotificationsUpdate/parseAppearanceUpdate`
  (303-363).

### src/http-handlers.ts — same-origin HTTP handlers
- Same-origin CSRF guard `isSameOrigin` (http-handlers.ts:78-99): matches `Origin`/`Referer`
  against the `Host` origin; mutating writes require exact same-origin `Origin`; refuses
  `sec-fetch-site: cross-site`. `MAX_BODY_BYTES = 16KB`.
- `guard(req,res,method)` → 405 on wrong method, 403 cross-site (176-186).
- `handleState` (194, GET 200 full projection), `handleMarketSelect` (207), `handleAaSelect` (228),
  `handleNotificationsUpdate` (249), `handleAppearanceUpdate` (271) → persistence-unavailable 501
  code `persist.unavailable`.
- `handleHostAction` (296-326): POST; capability check via `findCapability`; unsupported → **HTTP 501**
  + error body with the `capability` token + `unsupportedCode` (`host.unsupported`/`host.offline`).

### src/index.ts — Host entry + Cordis plugin
- `name='dsh-my-desktop-setting'` (index.ts:38); **`inject = ['webServer']`** (index.ts:44).
- `probeHost(ctx)` (index.ts:83-98): via `tryReadService` (72-80, catches Cordis throw-on-non-injected
  access) reads `desktopProfiles`,`desktopPnpm`,`desktopRuntime` + `process.env`
  (`DSH_DESKTOP_HOST`, `DSH_PROFILE_NAME`, dir flags).
- `probeLauncherPorts(ctx)` (index.ts:109-140): duck-typing `requestRestart/openTerminal/
  toggleDeveloperTools/exportDiagnostics` off any of `desktopRuntime`/`desktopSettingsController`
  ctx service.
- `HOST_ACTION_TOKENS` (index.ts:143-149) maps endpoint→token: profileSwitch→host.profile-switch,
  restart→host.restart, terminalOpen→host.open-terminal, devtoolsToggle→host.devtools,
  diagnosticsExport→host.diagnostics-export.
- `apply(ctx, config)` (155-195): if enabled, resolve store, build controller, then `webServer.register
  {kind:'exact', path, handler}` for the 5 preference routes + the 5 host-action routes, each owned by a
  `ctx.effect` disposer. If `config.enabled===false` → no-op; if no webServer → logs and returns.

### src/client/index.ts — browser client entry
- Namespaces: `desktop.settings` (plugin), plus registry bindings `dsh-desktop` and
  `dsh-desktop-notifications` (index.ts:29-33).
- **`inject = ['slots','locale','settingsScope']`** (index.ts:43).
- `apply(ctx)` (46-76): bind the two settings namespaces via `ctx.settingsScope.bind`, create the
  API, `ctx.locale.register('desktop.settings',{zh,en})`, `installDesktopSettingsStyles()`, and
  `ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section',
  id:'desktop-settings', order:100, label:()=>t('nav'), locale, inject:()=>({api,
  desktopSettings, notificationSettings})}, DesktopSettingsSection))` — i.e. renders into the
  official settings shell at order 100.

> Two separate "inject" concepts: the **browser client** declares Cordis service deps
> `['slots','locale','settingsScope']` (index.ts:43); the **package manifest**
> `package.json:31-38 dsh.client.inject` lists DSH client-module framework rows
> (`dsh-client-locale`, `dsh-client-ui-renderer`, `dsh-client-ui-settings`) that are kept
> external in the bundle.

### src/client/DesktopSettingsSection.tsx — the settings page component (520 lines)
- Props = `PropsRuntime<'settings.section'> & PropsLocale<'desktop.settings'> &
  InjectFace<DesktopSettingsSectionInjected>` (48-52).
- Injected business face (`DesktopSettingsSectionInjected`): `api`, `desktopSettings?`,
  `notificationSettings?` (39-45) — namespaces are registry surface only; values come from `api.read()`.
- `HOST_ACTION_TOKENS` (58-67): the 4 Host-专属 buttons rendered (restart, open-terminal, devtools,
  diagnostics-export); **profile-switch and web-and-material are deliberately excluded**.
- State: `view/busy/loadFailed/operationError/activeHostToken/restart` (187-192). Data flow:
  mount → `load()` → `api.read()` → validate → `view` → render (see §below). Writes run through
  `persistAndRefresh` (235-238) → re-`read()`.
- **Sections it renders** (return JSX, 283-498):
  1. Header `title`+`intro` (285-288); operation error / restart status banners (290-295);
     loading & unavailable+retry (297-303).
  2. **Host/Profile** group (307-347): static host-kind row (desktop vs web), profile list rows
     (name, current badge, bridge + directory flags), switch-profile note / UnsupportedNote.
  3. **Market** group (349-372): legacy notice, not-effective notice, 3 radio `Choice`s
     (disabled/community-market/dsh-market) with selected badge.
  4. **AA** group (374-396): 2 radio Choices (disabled/enabled) + not-effective notice.
  5. **Notifications** group (398-421): `ToggleRow` "enable notifications" + 4 sub-`ToggleRow`s
     (sessionEnd/errors/updates/progress) in a `.dshDesktopSettingsDetails` indented block.
  6. **Appearance** group (423-462): material `<select>` (off/transparent/mica/acrylic) +
     3 radio Choices for mode (compatibility/extended/advanced); native-vs-preference-only notice.
  7. **Host actions** group (464-494): 4 buttons for `HOST_ACTION_TOKENS`, disabled when capability
     unsupported (runs `api.performHostAction(token)`).
- Helpers: `Choice` (radio card, 104-151), `ToggleRow` (switch, 153-179), `UnsupportedNote` (181-183),
  `capabilityOf`, `errorMessage`, `modeLabelKey/modeBodyKey`, `isDesktopSettingsError`.
- Capability-driven disabling: `marketEnabled/aaEnabled/appearanceEnabled`/notification toggles and
  each host action = `capability.supported !== false` (268-281, 471-473).

### src/client/desktop-settings-api.ts — browser fetch client
- Re-exports all contract DTOs + `settingsPaths` from `../contract.ts` (byte-for-byte shared).
- `DesktopSettingsError {kind:'http'|'invalid'|'capability', status, code, capability, message}`
  (72-82). `DesktopSettingsApi` (85-98): `read/selectMarket/selectAa/updateNotifications/
  updateAppearance/performHostAction`.
- Full response re-validation `parseDesktopSettingsView` (275-304) before React state: strict key-set,
  token/material/mode guards, max lengths (profile 255, capabilities 64, reason 512), no duplicates,
  current∈profiles.
- `createDesktopSettingsApi(fetcher = fetch)` (395-424): same-origin fetch seam; POST with
  `credentials:'same-origin', redirect:'error'`. `hostActionPath` maps token→path (426-433).

### src/client/desktop-settings-locales.ts — zh/en copy
- `zh` object is the canonical key set; `DesktopSettingsLocaleKey = keyof typeof zh` (99).
- Full zh/en key lists (identical key set): `nav, title, intro, loading, retry, unavailable,
  operationFailed, restarting, restartRequired, selected, beta, unsupported, notProvided, readOnly,
  hostTitle, hostIntro, currentProfile, noCurrentProfile, profileCurrent, profileBridge,
  profileBridgeConnected, profileBridgeDisconnected, profileHasDirectory, profileDirectoryKnown,
  profileDirectoryUnknown, hostKind, hostKindDesktop, hostKindWeb, switchProfileUnavailable,
  marketTitle, marketIntro, marketDisabled, marketDisabledBody, communityMarket, communityMarketBody,
  dshMarket, dshMarketBody, marketLegacyNotice, marketNotEffective, marketApplyFailed, aaTitle,
  aaIntro, aaDisabled, aaDisabledBody, aaEnabled, aaEnabledBody, aaNotEffective, notificationsTitle,
  notificationsIntro, notificationsEnabled, eventSessionEnd, eventErrors, eventUpdates, eventProgress,
  appearanceTitle, appearanceIntro, materialLabel, materialNone, materialTransparent, materialMica,
  materialAcrylic, modeCompatibility, modeCompatibilityBody, modeExtended, modeExtendedBody,
  modeAdvanced, modeAdvancedBody, appearancePreferenceOnly, appearanceNative, hostActionsTitle,
  hostActionsIntro, actionRestart, actionRestarting, actionOpenTerminal, actionOpeningTerminal,
  actionDevtools, actionExportDiagnostics, actionExportingDiagnostics, actionNotProvided, actionFailed`.
- Note: locale keys exist but the styles file has CSS for LAN/dialog/native-menu which **no current
  component renders** → vestigial (see §below re parity gaps).

### src/client/desktop-settings-styles.ts — one injected `<style>`
- `installDesktopSettingsStyles()` (371-380): inserts one `<style id="dsh-desktop-settings-styles">`
  once; CSS uses official `--dsw-alias-*` / `--ds-*` design tokens.
- **Dead/vestigial CSS not exercised by DesktopSettingsSection**: `.dshDesktopNativeActions
  [data-placement="settings"]` + `.dshDesktopActionMenu`/`.dshDesktopActionMenuItem`
  (163-203), `.dshDesktopSettingsHeaderButton` (204-220), `.dshDesktopNativeActionError` (221-226),
  `.dshDesktopSettingsLanStatus`/`LanFingerprint`/`Urls`/`Dialog*`/`DeleteConfirm`/`Form`/`Field`/
  `Input`/`HeaderButton` (73-220, 296-362) — leftovers signalling a richer native UI that was not
  implemented. Strong hint of where feature/UI parity gaps live (LAN access, dialogs, native action
  menus, delete-confirm).

### Data flow (HTTP read → React render)
Browser `DesktopSettingsSection` mount → `api.read()` GET `/api/dsh-my-settings/state` →
Host `handleState` → `controller.read()` = stored `SettingsState.snapshot()` + `detectHostCapability`
(frozen `DesktopSettingsView`) → JSON. Client `readJsonResponse` → `parseDesktopSettingsView`
(throws `DesktopSettingsError`) → `setView`. Each group reads `view.*` and gates enabled/read-only off
`view.capabilities`. User edits → POST to the matching endpoint → re-`read()` refreshes `view`.

---

## 2. Plugin architecture contract (current)

- **Where it runs**: a standard third-party DSH plugin inside the `web` profile that
  dsh-my-desktop launches, same origin as the browser client (index.ts:4-8, contract.ts:4-6).
- **HTTP surface**: registers exact routes `/api/dsh-my-settings/{state,market/select,aa/select,
  notifications/update,appearance/update,profile/switch,restart,terminal/open,devtools/toggle,
  diagnostics/export}` on `ctx.webServer` (index.ts:178-194). Same-origin authorized.
- **Persistence**: self-consistent prefs in its own versioned JSON
  `.dsh-my-settings/state.json` under `DSH_PROFILE_DIR` or `DSH_HOME/profiles/<name>` (state-store.ts).
  Explicit plugin-owned path; never `process.cwd()`. **Not** the Electron launcher.
- **Capability gating**: Electron-only rows (restart, profile switch, terminal, DevTools, diagnostics
  export, native window material/LAN) answered with **HTTP 501 + stable `capability` token** +
  `unsupportedCode`/`reason` when no launcher service exists (http-handlers.ts:296-326,
  host-controller.ts:230-282). Nothing faked.
- **Injections**:
  - Host `inject = ['webServer']` (index.ts:44); capability services `desktopProfiles`/`desktopPnpm`/
    `desktopRuntime` are probed duck-typed (not declared), plus `process.env`.
  - Client Cordis `inject = ['slots','locale','settingsScope']` (client/index.ts:43).
  - Package-manifest client `dsh.client.inject` = the 3 module-table framework rows (package.json:31-38).
- **Rendering**: browser registers `settings.section` slot row `id:'desktop-settings', order:100`
  into the official Settings shell via `ctx.slots` (`dsh-client-ui-slots`), reading/writing via the
  shared `/api/dsh-my-settings` HTTP contract.

---

## 3. How the launcher packages + injects the plugin — `E:\project\dsh\dsh-my-desktop\`

### src/desktop-settings-plugin.ts
- `DESKTOP_SETTINGS_PACKAGE='dsh-my-desktop-setting'`; `DESKTOP_SETTINGS_FILES =
  ['lib/index.js','lib/client.js']` (28-34).
- `resolveDesktopSettingsDir` (37-48): packaged → `<resourcesPath>/dsh-my-desktop-setting`;
  dev → `$DSH_DESKTOP_SETTINGS_DIR` override, else sibling `<appDir>/dsh-my-desktop-setting` if
  `lib/index.js` exists, else app `desktop-settings-plugin` (no-op if absent).
- `prepareDesktopSettings(destDir, sourceDir)` (55-99): `mkdir destDir/lib`, copy `lib/index.js` +
  `lib/client.js`; write a **generated `package.json`** (name/version/type/main `lib/index.js`/
  exports incl `./client`/`dsh.bundle.patch:./cordis.patch.yml`/`dsh.client.inject` 3 rows/
  `platform:'web'`); write **`cordis.patch.yml` as `[]`** (neutralize the package's own bundle patch so
  no bare-name row loads); write **`settings.patch.yml`** = JSON-as-YAML top-level `[{insert:[{id:
  'dsh-my-desktop-setting', name: file://URL to destDir/lib/index.js}]}]`; return overlay path.
  Rationale (1-21): plugin deliberately NOT in the profile's `dsh.profile.bundles` (reserved for
  official bundles + community plugins; prune/reconcile would drop it). Injected via `--patch` overlay
  exactly like the desktop bridge.

### src/main.ts calls
- main.ts:32 import; main.ts:225-228 `prepareDesktopSettings(join(app.getPath('userData'),
  'desktop-settings-plugin'), resolveDesktopSettingsDir({...runtimeOptions,
  pluginDevDir: process.env.DSH_DESKTOP_SETTINGS_DIR}))` (runs after the desktop bridge at 220).
- main.ts:263-265: `patches` = `[desktopBridgePatch]` or, if a settings patch exists,
  `[desktopBridgePatch, desktopSettingsPatch]`.
- main.ts:269-276 env to launched DSH: `DSH_HOME: resolve(profileDir,'..','..')`,
  `DSH_PROFILE_DIR: profileDir`, `DSH_PROFILE_NAME:'web'`, `DSH_RUNTIME_DIR`, `DSH_PNPM_ENTRY`,
  `DSH_PNPM_STORE_DIR`.
- The `web` profile dir: `resolveWebProfileDir()` = `<DSH_HOME>/profiles/web` (plugin-seed.ts:140-142).
- `%APPDATA%\DSH My Desktop` is the userData root (app-identity.ts DESKTOP_USER_DATA_DIR,
  main.ts:116). Materialized plugin → `%APPDATA%\DSH My Desktop\desktop-settings-plugin\`.

### packaging in package.json
- `extraResources` (package.json:169-175): `{from:"dist/desktop-settings-plugin",
  to:"dsh-my-desktop-setting", filter:["**/*"]}` → ships to `resources/dsh-my-desktop-setting`.
- That `dist/desktop-settings-plugin` is **assembled by the build** (scripts/prepare-runtime.ts
  `stageDesktopSettingsPlugin`, 100-117), triggered by the `--stage-plugin` fast path (385-386) and by
  full prepare-runtime (96-97). Copies from `<repo>../dsh-my-desktop-setting` (or `DSH_DESKTOP_SETTINGS_DIR`)
  → `dist/desktop-settings-plugin/lib/{index.js,client.js}` + writes `cordis.patch.yml`=`[]`.
  **Only those two JS files + a stub cordis.patch.yml are shipped.** The `package.json` and
  `settings.patch.yml` are generated at launch materialization (desktop-settings-plugin.ts:66-97).
- desktop-bridge parallel (desktop-host.ts:253-316): `DESKTOP_BRIDGE_FILES` copied into
  `%APPDATA%\DSH My Desktop\desktop-bridge`, generated `package.json` + `desktop-bridge-client.js` +
  `cordis.patch.yml='[]'` + `desktop.patch.yml` overlay.
- Launch mechanism: `startDsh` (dsh-process.ts:45-67) spawns DSH web with `--patch <overlay>` args
  (dsh-process.ts:47-50) and sets `DSH_DESKTOP_HOST: patchArgs.length===0 ? undefined : '1'`
  (dsh-process.ts:56).

### Running-app materialized files (verified live)
`C:\Users\admin\AppData\Roaming\DSH My Desktop\desktop-settings-plugin\`:
- `lib/index.js`, `lib/client.js`
- `package.json` (the generated 24-line manifest, main/lib/index.js etc.)
- `cordis.patch.yml` = `[]`
- `settings.patch.yml` = JSON-YAML `[{insert:[{id:'dsh-my-desktop-setting',
  name:'file:///C:/Users/admin/AppData/Roaming/DSH%20My%20Desktop/desktop-settings-plugin/lib/index.js'}]}]`
DSH imports that row → host half applies in the server; the client half is served by the DSH
client-modules registry as `/plugins/dsh-my-desktop-setting/client.js`.

---

## 4. Launcher desktop-bridge + ctx services it provides to the web profile

- **src/desktop-host.ts** `createDesktopHostServices` (119-184) returns exactly two services:
  - `desktopProfiles` `{connected:true, current:{name,dir,connected}, list(), select()}` (162-175);
  - `desktopPnpm` `{connected:true, run(args), runPlugin}` (176-182) wrapping `runPlugin`/`runBundledPnpm`
    so plugin-market pnpm commands run via the bundled pnpm + `--store-dir`, then trigger
    `APPLY_PLUGIN_UPDATES_IPC` → launcher hot-restarts the DSH.
  - **No `desktopRuntime` service and no action ports** (no requestRestart/openTerminal/
    toggleDeveloperTools/exportDiagnostics exposed to ctx). `toggleDeveloperTools` is an in-launcher
    Electron method (main.ts:1566), not a ctx service. `profileSwitch` therefore hardcoded false
    (host-controller.ts:89, 274-278).
- **src/desktop-bridge.mts** (source of the shipped `.mjs`): `apply(ctx)` guards on
  `DSH_DESKTOP_HOST==='1' && process.connected && process.send` (18), resolves profileDir/pnpmEntry
  from env, then `ctx.provide('desktopProfiles',…)`/`ctx.provide('desktopPnpm',…)` and
  `ctx.set`+`ctx.<name>=` (28-37). This is how the launched DSH process's Cordis ctx gets the two
  services the plugin probes.
- **src/desktop-bridge-client-source.ts**: the **browser** half — `desktopBridgeClientFactory`
  (browser bundle wrapped as `window.__ModuleLoader__.load({id:'dsh-desktop-bridge',factory})`,
  line 319-321). It talks to `window.dshDesktopShell` (set by the Electron shell preload), drives
  navigation, notifications, badges, theme/locale reporting. Its `inject=['sessions','workspaces',
  'layout','locale']` (75). This is the "native coupling" pattern already used by the bridge client —
  a reference for what a native-coupled settings client could look like.
- **src/desktop-bridge-migration.ts**: migrates older profiles that had the bridge declared in
  `dsh.profile.bundles`/deps/`cordis.patch.yml` to the pure `--patch` overlay model — the precedent
  for how a profile row is moved/cleaned (relevant if rework changes injection).
- **dsh-process.ts:56** — `DSH_DESKTOP_HOST=1` set on the launched DSH when any patch is present.
- **What DSH_DESKTOP_HOST=1 enables in the plugin** (host-capability.ts probe + index.ts:83-98):
  `desktopEnv=true`; bridge states derive from ctx services (`desktopProfiles`/`desktopPnpm` present
  + `connected:true` → `'ready'`); `desktopRuntime` stays null here → `runtimePresent=false` →
  `host.web-and-material` unsupported and all Host-专属 actions unsupported/501 unless a ctx action
  port exists (none from dsh-my-desktop). So in THIS launcher every Host-专属 row degrades to read-only.

---

## 5. Plugin build entry points — `dsh-my-desktop-setting\`

package.json scripts (package.json:40-44):
- `clean`: `node scripts/clean.mjs` (removes `lib/` + `dist/`).
- `build`: `clean && tsdown && tsc -p tsconfig.json --emitDeclarationOnly &&
  tsc -p tsconfig.client.json --emitDeclarationOnly`.
- `typecheck`: `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit`.

Configs:
- **tsconfig.json** (host + shared): `rootDir:src`, `outDir:lib/types`, `declaration`, NodeNext,
  ES2024, `jsx:react-jsx`, strict/noUnused*, `verbatimModuleSyntax`, `types:['node']`,
  `include:['src/*.ts']` (25) — top-level host .ts only.
- **tsconfig.client.json**: extends tsconfig, `include:['src/client/**/*.ts','src/client/**/*.tsx']`
  — browser .ts/.tsx types only.
- **tsdown.config.ts**: two bundling configs —
  1. Node host: entry `index:'src/index.ts'` → `lib/index.js`, ESM, inlines all non-node-builtins
     (self-contained; 50-68).
  2. Browser client: entry `client:'src/client/index.ts'` → `lib/client.js`, **CJS/browser**, with a
     **purity gate** rejecting non-seed `@deepseek-ai/*` value imports (37-48, 82), a `PLATFORM_EXTERNALS`
     set kept external for the module table (`react`, `react/jsx-runtime`, `react-dom`,
     `@deepseek-ai/cordis`, `@deepseek-ai/cordis-plugin-loader`, 25-31), and a banner/footer wrapping it
     in `window.__ModuleLoader__.load({id:'dsh-my-desktop-setting', factory:(require)=>{…}})`
     (83-88).

**To rebuild after rework** (host + client):
1. In the plugin repo: `pnpm run build` → regenerates `lib/index.js` + `lib/client.js` (+ lib/types).
2. In the launcher repo: the plugin's built `lib/` are picked up by
   `scripts/prepare-runtime.ts` `stageDesktopSettingsPlugin` (via `../dsh-my-desktop-setting` or
   `DSH_DESKTOP_SETTINGS_DIR`) into `dist/desktop-settings-plugin`, then
   `scripts/build.ps1`/electron-builder ships them as `resources/dsh-my-desktop-setting`.
   - Dev/no-repack run: materialization reads sibling `dsh-my-desktop-setting/lib` directly
     (desktop-settings-plugin.ts:41-45) or `DSH_DESKTOP_SETTINGS_DIR`.
   - Fast packaged loop: `pwsh scripts/build.ps1 -Target dist-local` (tsc + `--stage-plugin` +
     electron-builder, cache-friendly per AGENTS.md).

---

## Key findings for reaching native-coupling feature/UI parity

1. **Host action ports are un-wired in this launcher.** The plugin honestly 501s restart/profile-
   switch/terminal/devtools/diagnostics + material/LAN because dsh-my-desktop only exposes
   `desktopProfiles`+`desktopPnpm` to the DSH ctx (no `desktopRuntime`, no action-ports). Native parity
   requires the launcher to expose real ctx service(s) (e.g. `desktopSettingsController` with
   `requestRestart/openTerminal/toggleDeveloperTools/exportDiagnostics`, plus a profile `select`) that
   `probeLauncherPorts`/`capabilityManifest` already know how to read (index.ts:109-140,
   host-controller.ts:230-282). Alternatively an IPC path from the web profile to Electron.
2. **Profile switch is hardcoded unsupported** even though capability/token plumbing exists
   (`host.profile-switch`, UI note + switch-capability logic, DesktopSettingsSection.tsx:343-346).
3. **Rendering is HTTP-driven, fully generic; appearance/mode/LAN UI is stub-ish.** The appearance
   group persists only material+mode; `host.web-and-material` (LAN/browser + material) is surfaced only
   as a capability, not as a usable LAN-status/URL/fingerprint UI — yet the stylesheet already contains
   `.dshDesktopSettingsLanStatus/Urls/Fingerprint/Dialog/NativeActions` CSS (styles 163-362) that no
   component renders. Feature/UI parity gaps are precisely these unimplemented native rows.
4. **Two distinct injection layers** must both be updated when reworking: (a) the browser client's
   Cordis `inject=['slots','locale','settingsScope']` + `ctx.slots` register; (b) the **package manifest
   `dsh.client.inject`** (module-table externals) in both the plugin `package.json` and the launcher's
   generated manifest (desktop-settings-plugin.ts:66-87). Client bundle purity gate forbids any new
   cross-plugin `@deepseek-ai/*` value import unless added to `PLATFORM_EXTERNALS` + module-table seed.
5. **Rebuild flow is two-stage** (plugin `pnpm build`, then launcher stage+pack) — verified exact files
   shipped = `lib/index.js`, `lib/client.js`, stub `cordis.patch.yml`; `package.json`+`settings.patch.yml`
   generated at materialization.
