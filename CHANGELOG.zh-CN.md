# 更新日志

[English](CHANGELOG.md)

## 0.4.0

版本升至 0.4.0。随包 DSH 运行时**不变**，仍为 0.1.5-rc.1 —— 它仍是
`@deepseek-ai/dsh` 在 npm 上的 `latest` 标签（与 0.2.1、0.3.0 的判断一致）。

- **随包预装 `dsh-codex-project`**（第五个）：Codex 式工作区共享子目录——一个工作区
  外挂任意可写根（可跨盘符），权限仍限 `workspace-write`。它以**已构建好的产物**随包，
  不是源码：`vendor/dsh-codex-project/<name>-<version>.tgz`（上游包自己 `pnpm pack`
  的产物，内含构建好的 `lib/`）入库并带校验和，由 `prepare-runtime` 拷进离线 store，
  首启按 `file:` 说明符补种。本仓库不构建它，也不保留第二份源码。
  - 之所以走这条路：适配本运行时的 0.12.0（peer `^0.1.5-rc.1`）**没有发布**；
    npm 上最新是 `0.1.2-alpha` 线的 0.11.0，其 peer 范围 `^0.1.0-rc.6` 按 semver
    规则拒绝 `0.1.5-rc.x`，上游 README 也明确该线已不支持。
  - 产物是**校验**而非信任：`stageVendorTarball` 校验 SHA256，并从压缩包里读出
    清单确认包名与版本——手工替换 blob 或只改一边的版本号都会让出包失败，而不是
    悄悄发出去。
  - **修掉一个让该特性在真实安装上完全失效的缺陷**：pnpm 把 store 记成
    `<root>/v11`，而 `resolvePnpmStoreDir` 原样返回，于是补种去
    `<root>/v11/vendor-tarballs/…` 找产物，而 `prepare-runtime` 正确地把它写在了
    `<root>/vendor-tarballs/…`。补种因此以「产物缺失」中止，插件永远不出现——
    尽管安装包里其实带对了。现在 `pnpmStoreRoot` 会剥掉 pnpm 的布局层，这也正是
    `--store-dir` 期望的形式（实测：传 root 进去，pnpm 回写的就是 `<root>/v11`）。
    另有 3 条既有用例把旧行为当成了正确行为，已一并更正。
  - 它走 **profile bundle** 而非 `--patch` overlay：其 bundle 层要 disable 核心
    `fs-sandbox` 行，并在该席位挂自己的多根 fs provider。
  - Windows ACL runner 的原生半 `koffi` 本就在 `ALLOWED_BUILD_PACKAGES` 里，
    这正是分阶段装配时它能构建成功的原因。
- **修掉两个既有的 store 装配缺陷**（与上述插件无关）：中断运行留下的旧
  `staging/` manifest 会被当成下一次的依赖集复用；registry 插件被写成
  `name@version` 作为 dependencies 的**值**，会被 pnpm 当 npm alias 解析并以
  `SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER` 失败。
- **`--stage-plugin` 现在也会装配插件仓库**。此前它只装设置插件，导致
  `dist:local` / `pack:local` 快速出包路径发出的 `store.tgz` 会静默停在
  上一次完整构建的内容。
- **`scripts/stage-installed.ps1` 现在会同步 `plugins-store.tgz`**（连同校验文件，
  并清掉已解压的树以便下次启动重新解压）。此前它只同步 app 与 bridge、不同步 store，
  于是「增量同步进已安装应用」会让随包插件集合停在旧版本——看起来生效了，其实没有。

## 0.3.0

版本升至 0.3.0。随包 DSH 运行时**不变**，仍为 0.1.5-rc.1 —— npm 上 `latest`
标签就是它（`next` 为 0.1.5-rc.2，本次不升，与 0.2.1 时的判断一致）。

- **随包社区插件由 1 个扩到 4 个**：`BUNDLED_PLUGINS` 新增
  `dsh-better-sidebar@0.19.1`（VSCode 式右侧边栏）、`dsh-vision-router@2.1.6`
  （为纯文本模型补视觉与像素级工具）、`dsh-context@0.50.0`（上下文看板与管理）。
  `dshmarket@1.45.1` 早已随包（见 0.2.1 段），本次未动。四者都在出包时装配进
  离线 store，首启 / 新建或切换 profile 时**零联网**补种，无需用户手动安装。
- **装配实测通过**：276 个包；`node-pty` 用既有 `ALLOWED_BUILD_PACKAGES` 白名单
  即可完成原生构建，无需放宽任何构建脚本限制。
- **代价：`store.tgz` 由 1.9 MB 涨到约 110 MB**（压缩后），这是本次改动的主要代价。
  四个插件自身代码合计仅约 27 MB，其余是共享依赖（CodeMirror 全家桶、mermaid、
  puppeteer-core 等）与 registry 缓存元数据。插件升级仍需重新出包。
- **文档修正**：README（en + zh-CN）里「默认不随包任何社区插件（`BUNDLED_PLUGINS`
  为空）」「不随包插件市场」的说法自 0.2.1 起即已不成立（`dshmarket` 当时就已随包），
  现已改为与代码一致，并把版本号从过时的 0.1.3 / 0.2.1 对齐到本版本。

## 0.2.1

版本升至 0.2.1。随包 DSH 运行时不变，仍为 0.1.5-rc.1。

这是**第一个真正带 `0.2.1` 版本号**的代码树：`0.2.0` tag 打在 version bump 之前
（见 0.2.0 段末的说明），因此下列改动此前没有任何 tag 承载。

- **版本对齐**：根 `package.json` 与随包插件 `dsh-my-desktop-setting` 均升至
  `0.2.1`（物化插件清单回退到应用版本，二者保持同步）。同时补完 0.2.0 时就该做
  的修正：`config.bundledDshVersion` 此前仍是 `0.1.2-rc.1`，现与
  `OFFICIAL_DSH_VERSION`（`0.1.5-rc.1`）及 README 文档一致。
- **终端 `dsh` 修复**：终端 shim 以「模块」方式 import 官方 CLI，导致 0.1.5 的
  `if (import.meta.main) await runCli()` 守卫恒为假，`dsh --version` 退出码 0 却零输出
  —— 与 0.2.0 的启动挂起同根因，只是发生在终端 shim 而非 bootstrap。
- **插件市场随包离线预装**：`dshmarket@1.45.1` 以离线 pnpm store
  （`plugins-store.tgz`）打进安装包，首启（以及新建/切换 profile）时补种进当前
  profile，**无需联网**。启用 store 重新接通了本就存在的链路：`prepare-runtime`
  装配 `store.tgz`、`extraResources` 随包携带、运行时解压步骤还原到 `plugins/store`。
  代价是插件升级需重新出包，安装包增大 ~1.8 MB（store 压缩后）。
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
- **预装社区插件扩到 4 个**：`BUNDLED_PLUGINS` 新增 `dsh-better-sidebar@0.19.1`、
  `dsh-vision-router@2.1.6`、`dsh-context@0.50.0`（`dshmarket@1.45.1` 已于 0.2.0 段
  随包）。四者都在出包时装配进离线 store，首启 / 新建或切换 profile 时**零联网**补种。
  装配实测通过：276 个包、`node-pty` 用既有 `ALLOWED_BUILD_PACKAGES` 白名单即可
  完成原生构建，无需放宽；四个插件自身代码合计约 27 MB，但 `store.tgz` 因共享依赖与
  registry 缓存元数据涨到约 110 MB —— 安装包体积是这次改动的主要代价。
  README 里「不随包任何社区插件 / 不随包插件市场」的过时说法同步修正。

## 0.2.0

随包 DSH 运行时升至 0.1.5-rc.1，并修掉随之而来的启动死锁。

以下三处修复针对的是同一起回归：运行时升级后，启动器与运行时在若干处各算各的，
且症状表现为**静默挂起**而非报错。

- **0.1.5 启动不再挂死**（`fix(runtime)`）：升到 0.1.5-rc.1 后桌面端卡在
  「server-starting」直到 45 秒超时。0.1.5 给 CLI 加了主模块守卫
  （`if (import.meta.main) await runCli()`），但 bootstrap 是用 `import()` 加载
  `bin.js` 的，故 `import.meta.main === false`，`runCli()` 从未执行 —— 进程活着、
  零输出、永不监听。现在 bootstrap 走真正会执行的调用路径。
  定位方式：直跑 `bin.js`（20 秒内监听）与经 bootstrap（stdout/stderr/ipc 全静默）
  二分对比。
- **bundle 检查与运行时解析统一到同一目录**（`fix(runtime)`）：
  `resolveDshRuntime` 与 `assertOfficialProfileBundlesAvailable` 各自独立计算运行时
  目录，导致 dev 下前者命中健康的 `runtime-dsh/`，后者却去看残缺的
  `userData\dsh-runtime`。于是对一个存在且正确的运行时报出荒谬的
  「缺少内置插件 dsh-base」。
- **dev 启动能找到 workspace 运行时**（`fix(runtime)`）：dev 的运行时候选链
  （`DSH_RUNTIME_ROOT` → `resources\dsh` → `..\deepseek-harness`）无法命中
  `prepare-runtime` 刚装配好的完整 `runtime-dsh/`，于是 `userData` 解包损坏时
  dev 直接报错，而打包版会自愈。现把 `<appPath>/runtime-dsh` 加为 dev-only 候选，
  不影响打包解析。

> **关于 `0.2.0` tag**：它指向 `303e498`，即上述三处运行时修复。version bump 与
> 现已归入 0.2.1 段的各项都发生在其后，因此**该 tag 对应的代码树里
> `package.json` 仍是 `0.1.4`**。真正携带 `0.2.1` 的是下面的 0.2.1 段。

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
