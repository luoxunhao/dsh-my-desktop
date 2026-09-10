# DESIGN — 让 dsh-my-desktop-setting 与 dsh-plugin-desktop 完全对齐（原生耦合）

> 目标：把 `dsh-my-desktop`（DSH My Desktop，单「web」profile 启动器）及其随包设置插件
> `dsh-my-desktop-setting` 改造为：设置页在**界面结构与功能**上完全对齐参考实现
> `dsh-desktop` 的 `dsh-plugin-desktop`（非 beta），并**真实驱动宿主能力**（profile 增删/切换、
> 窗口材质/模式、浏览器 + LAN/HTTPS、通知、devtools/restart/recovery/updates/diagnostics）。
>
> 本文是**差距分析与实施方案**，作为实现前的批准门。改动横跨启动器与插件两侧，量大、分阶段。
> （迁移后两者已同处 dsh-my-desktop 一个仓库：启动器在 `src/`，插件在 `plugins/desktop-settings/`。）

---

## 1. 参考实现到底是什么（先对齐认知）

`dsh-desktop` 仓库里的 `dsh-plugin-desktop` **不是一个“设置插件”，而是整套桌面启动器本身**。
它把宿主能力以 `/api/desktop/*` 暴露给随包 DSH web profile，并把「桌面设置」注册进官方 Settings shell。

它需要的宿主侧依赖（均在 dsh-desktop 仓库内，非第三方）：
- profile：`profiles.ts` / `profile-service.ts`（DesktopProfiles：`current/list/create/prepareSelection/delete/canDelete`）、
  `profile-manager.ts`、`profile-materializer.ts`、`profile-create-copy.ts`、`profile-checkpoint.ts`
  （真实的多 profile 注册表、可建/选/删/切，切换需重启整代）。
- market：`desktop-market.ts`（disabled / community-market / dsh-market 组合选择 + 重装）。
- web/LAN：`desktop-network.ts`、`desktop-browser-access.ts`、`lan-addresses.ts`、
  `lan-https-certificate.ts`、`lan-https-ingress.ts`、`webserver.ts`（真实 loopback URL、LAN HTTPS 边、
  CA 指纹/下载地址，live 状态 inactive/starting/ready/failed）。
- 外观：`window-material.ts`、`window-chrome.ts`（macOS transparent / Win mica，模式 compatibility/extended/advanced）。
- 通知：`notifications.ts`。
- 杂项宿主动作：`desktop-terminal.ts`、`relaunch-arguments.ts`、`updates.ts`/`update-checker.ts`、
  `diagnostic-export.ts`、`shutdown.ts`、`startup-recovery-controller.ts` 等。

其 HTTP 面 `desktop-settings-route.ts` 严格 loopback + 同源守卫，返回结构：
`current / profiles[{name,exists,webCapable,selectable,deletable}] / aa / market{requested,effective,legacyDefaulted} / web{localUrl,lanUrls,lanState,lanError,lanCaFingerprint,lanCaUrls}`。
动作端点：create/select/delete profile、selectAa、selectMarket、openTerminal、restart、
restart/recovery、reloadRenderer、toggleDeveloperTools、checkForUpdates、exportDiagnostics。
写操作很多是 **202 + `afterResponse`（res.end 后再去重启/切 profile）**。

UI 区块（`client/DesktopSettingsSection.tsx`，见 dsh-desktop）：Profile(列表+当前+删确认+新建输入)、
插件市场(disabled/community-market/dsh-market 外链 + beta + retry/legacy 态)、AA(开/关 + beta + 存态)、
Presentation(compatibility/extended/advanced 三态 + 平台材质下拉)、Web(开浏览器 + LAN 开关含确认弹窗 +
live LAN 状态 + localUrl/lanUrls + CA 指纹/下载)、Notifications(总开关 + turn/job 完成/失败 4 个子开关)。

## 2. 现状差距（dsh-my-desktop + dsh-my-desktop-setting）

### dsh-my-desktop（启动器）现状
- **单 profile 架构**：源码里唯一 profile 路径是硬编码 `resolveWebProfileDir() → <home>/profiles/web`
  （`src/plugin-seed.ts:140`）。全库 grep 无任何多 profile 概念 / profile 注册表 / 目录枚举。
- `createDesktopHostServices`（`src/desktop-host.ts:161`）暴露给 web profile 的 `desktopProfiles`：
  `list()` 恒返回 `[{web}]`，`select()` 是 **no-op**；`desktopPnpm` 才是真实 pnpm 桥。
- 重启/回收：`recycleDshForPluginUpdate`（`main.ts:686`）停当前 DSH 子进程、在同一 profile 上重启并
  `openWorkbenchOrRecovery` 重指窗口 —— 没有“切到另一个 profile”的路径；`lastStartOptions/lastSeedOptions`
  也是捕获固定 web profile 的。
- 窗口 Web UI 由 Electron 窗口承载（`dsh-process.ts` `--no-open`），port 为 `DSH_DESKTOP_WEB_PORT` 或 0。
- 没有 `desktopRuntime` 服务 / devtools/terminal/diagnostics/updates/notifications 桥（多数只有
  `openDshTerminal`、托盘、updater 的局部实现，未作为 ctx 服务暴露）。
- 随包插件注入：`src/desktop-settings-plugin.ts` `prepareDesktopSettings` 每次启动把
  `dist/desktop-settings-plugin`（dev 下为仓库内 `plugins/desktop-settings/lib`）物化到
  `%APPDATA%\DSH My Desktop\desktop-settings-plugin` 并 `--patch` 注入 `file:///...lib/index.js`。

### dsh-my-desktop-setting（插件）现状
- host：`src/index.ts` inject `['webServer']`，注册 `/api/dsh-my-settings/*` exact 路由；
  `state-store.ts` 把偏好持久化到 `DSH_PROFILE_DIR/.dsh-my-settings/state.json`；
  `host-capability.ts` + `http-handlers.ts` 用 capability 清单对宿主专属项给 `501+capability`；
  host 探 `DSH_DESKTOP_HOST` + `ctx.desktopProfiles/desktopPnpm/desktopRuntime`（无则降级）。
- 契约 `contract.ts`：`DesktopSettingsView{current,host{desktopHost,bridges,profiles},market,aa,
  notifications{sessionEnd/errors/updates/progress},appearance{material,mode,nativeCapable},capabilities[]}`。
- UI `client/DesktopSettingsSection.tsx` 刻意收敛：profile 只读 host identity（不建/删/切）、外观统一
  material(off/transparent/mica/acrylic) + mode、无浏览器/LAN 区块、通知用 sessionEnd/errors/updates/progress。
  其 PLAN.md §6.3 自述这些是相对 dsh-desktop 的“降级改动”。

> **关键结论**：参考 `dsh-plugin-desktop` 是“多 profile 启动器 + 原生能力”，而 `dsh-my-desktop`
> 是“刻意单 profile 启动器”，且插件刻意“宿主无关、诚实降级”。要“完全对齐 + 原生耦合”，
> 需要把 dsh-my-desktop 从单 profile 启动器升级为能管理多 profile 并暴露一堆原生桥的启动器，
> 再把插件从自洽降级模型改成真实调用这些桥。量级接近把 dsh-my-desktop 重构成一个
> 简化版 dsh-desktop。

---

## 2.5 ⚠️ 最关键的架构分歧（决定桥怎么搭）

调研证实：**dsh-desktop 是单进程启动器** —— Electron main 通过 `boot()`（`@deepseek-ai/dsh-app-boot`）
把 DSH Host/Cordis ctx **在 Electron 主进程内运行**；`desktopProfiles/desktopPnpm/desktopRuntime/
desktopSettingsController/desktopLanHttps` 全部在同一进程 `hostCtx.provide(...)` 提供，
`/api/desktop/*` 直接注册在**同进程** `ctx.webServer` 上；浏览器渲染器只是另一个 Electron renderer，
经 loopback 同源 HTTP 访问。原生能力（材质在重启应用、LAN HTTPS 是 0.0.0.0 反代边、devtools/reload 等）
都在同一个 Host ctx 里，天然可达。

**dsh-my-desktop 不是这样**：Electron main **spawn 一个独立 plain-node DSH 子进程**承载 web profile
（`dsh-process.ts`），窗口只是加载该子进程 URL 的渲染器。启动器只把 `desktopProfiles/desktopPnpm`
以 `--patch` overlay 注入**子进程**；native 动作（重启、devtools、材质、updater、终端、诊断）都活在
**Electron main**，与 DSH 子进程是**两个进程**。

**推论**：dsh-desktop 的“原生耦合”在 dsh-my-desktop 需要**跨进程桥**（子进程 ↔ Electron main 经
IPC/stdin/HTTP），这是参考实现不需要的额外层。因此方案里「宿主 ctx 服务」在 dsh-my-desktop 侧 = 
主进程提供真实实现 + 一条到子进程的可调用通道（桥内暴露同形 ctx 服务）。材质/重启等“需重启整代/
窗口重建”语义与 dsh-desktop 一致：多数写操作 202 + afterResponse（主进程收到后重启/重建窗口）。

## 3. 推荐实施路径（分阶段，每阶段可独立验收）

> 以下按“让 UI 与 dsh-desktop 逐项一致，并让每项都有真实宿主支撑”的最小合理集合推进。
> 若某阶段超出预期，可单独砍掉或降级为只读提示（文档保留为已知取舍）。

### 阶段 0 — 工程与测试基座
- 启动器与插件各自保持 `pnpm check` / `build` 绿（插件走 `check:plugin` / `build:plugin`）。
- 为启动器与插件建立可重复的本地跑验证：
  dev `pnpm start`（dsh-my-desktop）+ 安装版路径对照。

### 阶段 1 — profile 多实例与注册表（最大的一块）
在 `dsh-my-desktop` 内引入**受管 profile 概念**（对齐 dsh-desktop `profiles.ts/profile-service.ts/profile-manager.ts` 的裁剪版）。

已确认的现状与**插入点**（research 证实）：
- 单 profile 写死：`resolveWebProfileDir()`（`src/plugin-seed.ts:140`）恒返回 `profiles/web`；
  DSH 子进程 env `DSH_PROFILE_NAME:'web'`（`main.ts:272`）；运行时在共享 `dsh-runtime`（`app-identity.ts:14`），
  profile 只差 bundle 组合；磁盘 `~/.dsh/profiles` 下已有 `web` + 一个真实 `desktop` profile（可共存）。
- **CREATE 现成脚手架**：`ensureProfileScaffold(newDir)`（`plugin-seed.ts:457`）写新 profile 的
  package.json(`name:'dsh-profile-<x>'`, bundles=官方, 空 cordis.patch.yml, pnpm-workspace)；随后
  `seedBundledPlugins({profileDir:newDir})`（`plugin-seed.ts:355`）+ `applyPendingProfileUpdates`。
- **SWITCH 现成回收器**：`recycleDshForPluginUpdate`（`main.ts:686-730`）已实现“停当前 DshServer →
  re-seed → startWithProfileSelfRepair→startDsh → openWorkbenchOrRecovery(profileDir,server.url) 重指窗口”；
  但它复用冻结的模块级 `lastSeedOptions/lastStartOptions`（都是 web）。切换到新 profile = 泛化此函数：
  (a) 由选中名算新 `profileDir`；(b) 重建 startOptions/seedOptions（新 DSH_HOME/DSH_PROFILE_DIR/
  DSH_PROFILE_NAME）；(c) re-seed/scaffold；(d) `startDsh`；(e) `createMainWindow(server.url)`（`main.ts:416`）
  或 `openWorkbenchOrRecovery` 重指 `dshView` 并重置 `allowedOrigin`。
- **SELECT 桥**：`desktopProfiles.select()`（`desktop-host.ts:172`）现在是 **no-op**；bridge 跑在 DSH 子进程内，
  只能经 `process.send` 回 main → 需新增一条携带目标 profile 名的 IPC 消息让 main 跑泛化回收。
  切换后重绑 `profileWatcher`（`main.ts:299`）+ 刷新 `lastSeedOptions/lastStartOptions`。
- **DELETE**：现无任何删除；`removeProfileBundle` 只删单个 bundle；最接近整树移除的是 recovery 的
  `RECOVERY_TRASH_DIR` 移入回收站模式（`recovery-mode.ts`）。需守卫：不删正在运行的 profile，删前先停其子进程。
- **持久化当前/上次 profile**：现无任何 active/selected/last-profile 状态；需新增一份注册表（建议 `.dsh/profiles/registry.json` 或 userData），启动时读取「上次 active」而非写死 web。

实施要点：
- `launch`/env/`openDshTerminal`（`main.ts:1394` 的 `'web'`）改为读取 active profile 名。
- `createDesktopHostServices` 的 `desktopProfiles` 改为真实 `current/list/create/select/delete/canDelete`；
  名称校验照 dsh-desktop `assertDesktopProfileName`。
- 兼容：保留默认 web profile 作为首个/默认，新老安装平滑迁移。

### 阶段 2 — 宿主能力桥暴露给 web profile
新增一个「桌面能力 ctx 服务」（对齐 dsh-plugin-desktop 的 controller bootstrap），挂在 web profile 内
由 `dsh-my-desktop-setting` host 消费；dsh-my-desktop 把下列能力经 bridge/IPC 或直接 ctx 注入：
- `desktopRuntime` / `desktopSettingsController`：提供 `requestRestart/openTerminal/toggleDeveloperTools/
  exportDiagnostics/reloadRenderer/restartToRecovery/checkForUpdates`（能做的做，dsh-desktop 语义）；
- 窗口材质/模式：读/写 `window-material`（Win mica，platform 判定）+ mode；dsh-my-desktop 侧补真正应用；
- 通知宿主：`notifications.ts` 语义 → turn/job 完成/失败；
- LAN/浏览器：`readWeb()` 产出 `{localUrl, lanUrls, lanState, lanError, lanCaFingerprint, lanCaUrls}`。
  dsh-my-desktop 当前是 loopback web 承载，**先只暴露 localUrl（127.0.0.1）+ lanState=inactive**；
  LAN HTTPS 边(`lan-https-*`)作为可选增强，未接则状态恒 inactive/降级。

### 阶段 3 — 插件 host 重构为 dsh-plugin-desktop 形态
`dsh-my-desktop-setting` host（`contract/http-handlers/host-controller/index`）改为：
- 契约切到 dsh-plugin-desktop 形状：`current/profiles/aa/market/web`（去掉自洽 notifications/appearance/capabilities
  那些私有投影，改成 dsh-desktop 一致 + 由 host 桥驱动）。可保留一个内部 capability 清单用于缺失时的降级展示，
  但**主路径是真实桥**。
- 端点/守卫对齐 `desktop-settings-route.ts` 的 loopback+同源模型（顺带修掉我们之前手写同源守卫的歧义）。
- 动作语义对齐：create/select/delete profile、selectAa、selectMarket、restart 等都 202/200 + afterResponse。

### 阶段 4 — 插件 client / UI / locales / styles 对齐
- 把 `client/DesktopSettingsSection.tsx` 重写为 dsh-plugin-desktop 的结构（Profile CRUD、market 外链+态、
  AA、Presentation、Web/LAN、Notifications 4 项、LAN 确认弹窗、删除确认、retry/legacy/存态）。
- `desktop-settings-api.ts` / `desktop-settings-locales.ts`(zh/en 全 key) / `desktop-settings-styles.ts`
  按参考补齐（区块 class、状态、弹窗样式）。

### 阶段 5 — 打包与端到端验收
- `dsh-my-desktop` 的 `dist/desktop-settings-plugin` 装配 + 安装版资源刷新。
- 真机（安装版 + dev）打开桌面设置逐区块比对 dsh-desktop 截图，验证可交互且真实生效。

---

## 4. 关键设计决策 / 取舍（需在批准时确认）

1. **多 profile 是否默认引入**：dsh-my-desktop 现状单 profile。完全对齐需多 profile 管理（建/切/删/
   持久化上次选择 + 切换重启）。这是最大工作量。是否接受「先保留默认单 web + 允许新建/切换为次要 profile」？
2. **LAN/HTTPS 边**：dsh-my-desktop 是 loopback web 承载。要完全对齐 dsh-plugin-desktop 的 LAN 开关需
   新增真实 LAN HTTPS 边（证书/CA/端口）。本方案默认**先只做 localUrl + inactive**，LAN 项 UI 在但按
   宿主能力降级为 inactive/不可用，是否可接受，还是必须真做 LAN？
3. **devtools/restart/recovery/updates/terminal/diagnostics**：多数 dsh-my-desktop 已有内部实现但未以
   ctx 服务暴露。是否完整接，还是先接「设置页会显示且常用的」（restart、terminal、devtools、diagnostics）。
4. **通知语义**：dsh-desktop 用 turn/job 完成/失败；当前插件用 sessionEnd/errors/updates/progress。
   完全对齐 → 通知项改为 turn/job 四项并由原生通知宿主驱动。

## 5. 文件级改动点（示意，随调研子代理精修）

> 迁移后两侧同处一个仓库；下方按「启动器侧 / 插件侧」区分，插件侧路径前缀为 `plugins/desktop-settings/`。

- 启动器侧：`src/plugin-seed.ts`(profile 根/清单)、新增 `src/profiles.ts`、`src/profile-scaffold.ts`、
  `src/profile-switch.ts`、`src/main.ts`(launch 参数化 + switchProfile + openWorkbenchOrRecovery)、
  `src/desktop-host.ts`(真实 desktopProfiles/desktopSettingsController)、`src/desktop-host-services.ts`(能力桥)、
  `src/window-*.ts`(材质/mode 暴露)、`src/dsh-process.ts`、`src/desktop-settings-plugin.ts`(物化不变)。
- 插件侧：`src/contract.ts`、`src/host-controller.ts`、`src/http-handlers.ts`、`src/index.ts`、
  `src/client/desktop-settings-api.ts`、`src/client/DesktopSettingsSection.tsx`、
  `src/client/desktop-settings-locales.ts`、`src/client/desktop-settings-styles.ts`、删除 `state-store`/自洽模型或降为后备。

## 6. 验收

- dev 与安装版均能打开「桌面设置」，且各区块布局/文案/交互与 dsh-desktop(dsh-plugin-desktop) 一致。
- Profile 建/切/删真实落盘并生效（切换后窗口指向新 profile 的服务）。
- 材质/模式（能做的平台）、通知、restart/terminal/devtools/diagnostics 真实触发。
- 构建走仓库 `scripts/build.ps1`（启动器 + 插件一起），typecheck 通过。
