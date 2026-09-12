# 更新日志

[English](CHANGELOG.md)

## 0.2.1

版本升至 0.2.1。随包 DSH 运行时不变，仍为 0.1.5-rc.1。

- **关闭「关于」不再拖垮应用**：`preventWindowsOwnedWindowFlash` 在 `close` 时断开父窗
  以规避 Windows 的主窗闪烁，但 Electron 拒绝对**模态窗口**调用 `setParentWindow`
  （"Can not be called for modal window"）。该异常抛在 `close` 处理器内，窗口照常关闭，
  却会冒到 `process.on('uncaughtException')` —— 启动器将其视为启动失败，并把主窗口
  替换成「启动失败」页。现在模态窗口直接跳过；它们本也不需要该规避（系统会把模态窗
  压在父窗之上，身后没有可闪的主窗）。
- **浅色主题现在能到达顶栏**：`bar.css` 的浅色规则全部以
  `:root[data-color-scheme="light"]` 为准，但从未有人把该属性写到外壳窗口上 ——
  `shell.html` 没有首屏前置主题脚本，`ShellBar` 也没有应用 bootstrap 里的主题，
  于是顶栏退回深色默认值，而下方内容已变浅。现在两侧齐备：文档脚本负责首屏，
  `applyColorScheme` 负责运行时的主题切换。
- **恢复页双向跟随主题**：同一个缺失属性使 `styles.css` 退回**浅色**分支，导致深色模式下
  恢复页反而是浅的 —— 与顶栏问题方向相反的同一个 bug。现在 `?theme=` 在首屏前即生效
  （CSP 相应放宽 `script-src 'unsafe-inline'`）。
- **外壳窗口迁移到 Vite + React**：五个手写文档
  （`assets/{shell,about,shortcuts,settings,startup}.html`）改为 React 应用。因为窗口以
  `file://` 加载，每个 bundle 必须是经典脚本，而 Vite 8 (Rolldown) 拒绝 IIFE 多入口 ——
  故新增 `scripts/build-shell-ui.mjs` 逐个构建。窗口按钮改由渲染进程自绘，消除了原生
  `titleBarOverlay` 造成的接缝（它只能涂纯色）。
- **UI 源码统一到 `frontend/`**：`src/shell-ui` → `frontend/shell`，
  `src/recovery-ui` → `frontend/recovery`；产物落 `dist/frontend/{shell,recovery}`，
  打包后落 `resources/frontend/{shell,recovery}`。
- **`stage-installed.ps1` 修正**：它原本只同步 `app.asar`，但外壳文档与恢复页是优先从
  `process.resourcesPath/frontend/` 读取的 —— 于是同步后运行中的应用仍在读旧 HTML。
  现已同步这两个目录，并清除改名前的旧副本。
- **`.gitignore` 锚定**：无前导斜杠的 `runtime/` 会匹配任意层级的 `src/runtime/`，
  导致该目录下新增文件被静默忽略。构建产物规则现已加前导斜杠。
- **移除 `plugins/dsh-market/`**：它是上游参考 clone（自带 `.git`），构建从不使用 ——
  预装走 npm 的 `dshmarket@1.45.1`。不加 ignore 的话它会被提交成一个裸 gitlink，
  使克隆者拿到一个空目录。

## 0.2.0

版本升至 0.2.0。随包 DSH 运行时为 0.1.5-rc.1。

- **版本对齐**：根 `package.json` 与随包插件 `dsh-my-desktop-setting` 均升至
  `0.2.0`（物化插件清单回退到应用版本，二者保持同步）。
- **陈旧运行时引用修正**：`config.bundledDshVersion` 此前仍是 `0.1.2-rc.1`，
  已修正为真实的 `0.1.5-rc.1`（与 `OFFICIAL_DSH_VERSION` 及 CHANGELOG/README 一致）。
- **终端 `dsh` 修复**：终端 shim 以「模块」方式 import 官方 CLI，导致 0.1.5 的
  `if (import.meta.main) await runCli()` 守卫恒为假，`dsh --version` 退出码 0 却零输出。
  现在 shim 在 import 后显式调用导出的 `runCli()`（与启动器 bootstrap 同一修复）。
- **插件市场随包离线预装**：`dshmarket@1.45.1` 以离线 pnpm store
  （`plugins-store.tgz`）打进安装包，首启（以及新建/切换 profile）时补种进当前
  profile，**无需联网**。启用 store 重新接通了本就存在的链路：`prepare-runtime`
  装配 `store.tgz`、`extraResources` 随包携带、运行时解压步骤还原到 `plugins/store`。
  代价是插件升级需重新出包，安装包增大 ~1.8 MB（store 压缩后）。
- TODO：发版前补全 0.2.0 的功能清单。

## 0.1.4

恢复助手重建为一等修复入口，逐面板对齐 dsh-desktop；随包 DSH 运行时升至
0.1.5-rc.1。

- **恢复页 1:1 重建**：单个 React 应用、六个标签页 —— 快速恢复（含安全模式）、
  插件管理、回滚、切换 Profile、重置与数据管理、诊断。旧页面只有五个手写标签，
  且没有数据页。全部文案集中在双语文案表（`recovery-copy.ts`），
  与参考实现的对齐可随时 diff。
- **健康快照对用户可见**：三槽位系统自 checkpoint 工作起就存在，但任何启动路径
  都没有写入者。现在每次健康启动都会捕获快照，回滚面板展示每槽的捕获时间、
  桌面端版本、插件数、配置文件数与大小，并提供「浏览文件」「回滚到此槽位」。
- **跨 Profile 回滚**：槽位记录自己的来源 profile，可把内容恢复进当前 profile
  （dsh-desktop 模型）。页面只展示当前 profile 的三个槽；profile 在原因卡中
  统一标注一次。
- **安全模式真正生效**：进入即带一次性标记重启整代应用，启动门准备一次性
  DSH home（与用户数据隔离），页面显示激活态。同一修复还阻止了普通重启继承
  恢复/安全模式标记 —— 此前从恢复页重启会永远打转回恢复页。
- **恢复页内切换 Profile**：切换到其它支持桌面端的 Profile，
  走同一套带确认的重启路径。
- **诊断包**：一键导出启动诊断、错误日志与 Profile 清单为单个文本文件，
  并支持「在文件夹中显示」。
- **数据管理**：展示当前 DSH 数据目录，可更改或恢复默认；出厂重置
  （移入回收站 + 重建）独立成卡。两者都运行在跨进程操作锁下，
  两个数据操作不再可能交错执行。
- **恢复页重启修复**：底部重启动作改为重启整个应用，而不是调用
  「返回工作台」—— 后者在恢复会话里必然失败（"DSH 尚未成功启动"）。
- **随包 DSH 运行时 → 0.1.5-rc.1**，4 个 client 包重新入库对齐。
- 测试：330 → 502（新增覆盖集中于"静默失败"类：快照捕获接线、跨 profile
  回滚、操作锁、IPC 合同漂移、重启语义、UI 文案对齐）。

## 0.1.3

桌面设置插件并入本仓库，启动器与插件改为一体构建。

- **插件源码并入仓库**：`dsh-my-desktop-setting` 迁到 `plugins/dsh-my-desktop-settings/`，
  成为 pnpm workspace 成员，随 desktop 一起构建、一起发布（不再单独发 npm）。
  其规划与差距分析文档（`PLAN.md`、`DESIGN-align-dsh-desktop.md`）一并迁入。
- **一体化构建**：新增 `build:all`（插件 → 启动器）。所有出包路径（`dist` / `pack` /
  `start` / `dist:local` / `pack:local`）最终都会构建插件。此前只有 `dist:local` /
  `pack:local` 会构建插件，`dist` / `pack` 只装配「恰好存在」的产物——而插件产物是
  gitignored 的，全新 clone 上出包会**静默产出没有桌面设置页的安装包**。
- **打包失败更快**：插件产物缺失时 `stageDesktopSettingsPlugin()` 直接报错，
  不再警告后跳过。
- **插件版本不再漂移**：物化清单的版本改为读插件自身 `package.json`
  （缺失/损坏时回退到应用版本），此前写死为 `0.1.0`。
- 新增 5 条测试覆盖上述约束（产物缺失必须失败、只缺 client 也必须失败、
  递归展开 `pnpm run` 链断言出包脚本都会构建插件、版本解析与回退）。

### 0.1.2 及更早（未单独发版，随 0.1.3 一并发布）

- **多 profile 管理**：profile 不再写死 `web`，支持列出 / 新建 / 删除 / 切换，
  选中态持久化到 `profile-registry.json`，切换需重启服务。删除为移入回收站，
  当前 profile 不可删。
- **内置桌面设置页**：随包 `dsh-my-desktop-setting` 插件（host + client），注册进
  DSH 设置壳的 `settings.section`，界面与交互对齐 `dsh-desktop`。它不安装进任何
  profile，而是每次启动以 `--patch` overlay 注入当前 profile，因此跟随 profile 切换。
- **桌面桥暴露 ctx 服务**：`desktopProfiles` / `desktopPnpm` / `desktopRuntime`
  注册在 `ctx.root`（Cordis 作用域隔离要求如此），子进程 ↔ Electron main 经
  `process.send` 请求/应答 IPC 通信。
- **profile 操作不再卡界面**：新建/删除后无需重启即可看到结果；建 profile 的
  超时与选 profile 分开设置（新建要 seed，可能几十秒），且永不挂死 HTTP 响应。
- 修复同名 profile 删除后重建会继承上一次「确认删除」样式的问题。
- 顶栏改为 `dsh-desktop` 风格；终端可执行 `dsh` CLI（仅注入该终端进程的 PATH，
  不改系统 PATH）。
- 产品名统一为 **DSH My Desktop**；修复安装时用 `notification.ico` 覆盖开始菜单
  快捷方式图标的问题。

## 0.1.0

**DSH My Desktop** 首个版本——面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的原生 Electron 启动器。

本版本定位是启动器 / 桌面壳：

- **不随包任何社区插件**（`BUNDLED_PLUGINS` 为空），也不预装任何插件。
- 只随 Electron 桌面壳、随包 Node.js + pnpm 运行时，以及启动本地 `web` profile 所需的官方 DSH 核心运行时。
- 插件由用户运行时自行安装（例如 `dsh plugin --profile web add <package>`，或把市场类插件如 `dshmarket` 装进 profile）。安装包不随任何插件。

本版本提供的能力：

- 原生桌面窗口（含托盘、通知、主题、缩放、窗口状态）。
- 在经校验的 `127.0.0.1` 回环地址启动本地 DSH 核心，并把其 Web UI 承载在桌面壳中。
- 桌面桥接仅在 Desktop 启动 DSH 时注入；手动运行 `dsh web` 走正常 Web 插件通道。
- 启动自修复：启动 DSH 前剥离 profile 中无效的条目。

窗口里看到的对话/工作台 UI 由 DSH 核心和你装进其 `web` profile 的插件提供；本项目本身不实现该 UI。

发布标签：[`v0.1.0`](https://github.com/luoxunhao/dsh-my-desktop/tree/v0.1.0)。
