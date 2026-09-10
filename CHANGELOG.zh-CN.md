# 更新日志

[English](CHANGELOG.md)

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
