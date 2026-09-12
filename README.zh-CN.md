<div align="center">

# DSH My Desktop

**面向 DeepSeek Harness 的原生桌面启动器。**

[English](README.md) · [更新日志](CHANGELOG.zh-CN.md)

[![许可证](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> DSH My Desktop 是 DeepSeek Harness 的社区维护桌面启动器，并非 DeepSeek AI 官方产品。

DSH My Desktop 是一个 Electron 应用：它在本地启动一个
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 实例，并把其
Web 界面承载到原生桌面窗口里。安装包自带 Node.js 与一套自包含的 DSH 核心运行时，
打开应用即可使用 DSH，无需自行安装 Node.js，也不必从终端启动。

## 这个项目实际是什么

DSH My Desktop 是**启动器 + 桌面壳**。它本身**不实现**对话/工作台 UI。窗口里看到的内容，
来自 DSH 核心（`@deepseek-ai/dsh`）以及你安装进**当前 profile** 的插件。

本版本（0.3.0）：

- 离线随包 **4 个社区插件**（`BUNDLED_PLUGINS`）：`dshmarket`、`dsh-better-sidebar`、
  `dsh-vision-router`、`dsh-context`。出包时装配进 `store.tgz` 打进安装包，
  首启**零联网**补种进 profile；
- 随包一个**内置的桌面设置页**（`dsh-my-desktop-setting` 插件，源码在
  `plugins/dsh-my-desktop-settings/`），启动时注入——见下文；
- 支持**多 profile 管理**：列出、新建、删除、切换，选中态跨重启保留；
- 在本地经校验的 `127.0.0.1` 回环地址启动所选 profile（`dsh-base` +
  `dsh-web-app`），并把 Web UI 放进 Electron 窗口；
- 提供一个桌面壳：窗口/托盘、通知、主题、缩放、设置窗口与更新检查。

## 平台状态

| 平台 | 状态 |
| --- | --- |
| Windows x64 | 已在本项目实际打包并本地运行（NSIS 安装器 + 便携 zip） |
| macOS / Linux | 打包目标已配置（dmg/zip、AppImage/deb），但尚未在本项目构建/验证 |

目前**只有 Windows x64** 真正打包并跑起来过。

## 随包内容 vs 不随包

| 组件 | 是否随包 |
| --- | --- |
| Electron 桌面壳 | ✅ 是 |
| Node.js 运行时 + pnpm | ✅ 是 |
| DSH 官方核心运行时（`@deepseek-ai/dsh` 系列，0.1.5-rc.1） | ✅ 是 |
| 桌面设置插件（`dsh-my-desktop-setting`） | ✅ 是——由本仓库构建 |
| 社区插件（`dshmarket`、`dsh-better-sidebar`、`dsh-vision-router`、`dsh-context`） | ✅ 是——从随包离线 store 补种 |

核心运行时预装且与 profile 隔离，你之后安装的插件不会覆盖随包运行时。

## Profile

Profile 是受管对象，不是写死的 `web` 目录：

- 每个 profile 位于 `<DSH_HOME>/profiles/<name>/`（Windows 为 `~/.dsh/profiles/<name>`）。
- 选中态存在 `%APPDATA%\DSH My Desktop\profile-registry.json`，缺失或损坏时回退到 `web`。
- 可在内置的桌面设置页新建、删除、切换 profile。删除是移入回收站，且**当前 profile 不可删**。
- 切换 profile 会重启本地 DSH 服务；新建的 profile 首次启动需要自行 seed（pnpm 装依赖），
  **耗时较长是正常的**。

## 内置的桌面设置页

安装包随带一个私有插件 `dsh-my-desktop-setting`，源码就在本仓库
`plugins/dsh-my-desktop-settings/`。它与启动器一起构建、一起打包，并向 DSH 设置壳注册一个
「桌面设置」区块。

它**不会安装进任何 profile**。启动器每次启动时把它物化到
`%APPDATA%\DSH My Desktop\desktop-settings-plugin\`，再以 `--patch` overlay 注入**当前
选中的 profile**。由此带来两点值得知道的结论：

- 它**跟随 profile**——切换 profile 不需要重装。
- 它是启动器的功能，不是 profile 的依赖，因此永远不会出现在 profile 的
  `node_modules` 或 `dsh.profile.bundles` 里。

## 首次启动

首次启动时，应用会在 `~/.dsh/profiles/web` 准备官方 `web` profile，并把随包的
4 个社区插件补种进去——**全程不需要联网**（它们以离线 store `store.tgz` 的形式
随安装包分发）。之后新建或切换到还没有这些插件的 profile 时，同样会补种。

要再装别的插件请自行安装，例如用 DSH CLI 指向本应用的运行时：

```sh
dsh plugin --profile web add <package>
```

随包插件钉死精确版本：升级靠出新版安装包（或在应用内经插件市场升级——市场会把
待更新记录写进 profile，与随包预装是同一套机制）。

## 桌面壳提供了什么

- 加载本地 DSH Web UI 的桌面窗口。
- 在桌面设置页管理 profile（新建 / 删除 / 切换）。
- 随包的桌面设置页，涵盖 profile、插件市场、AA、外观、通知与宿主动作
  （重启、终端、开发者工具）。
- 托盘图标与“重新加载”动作（重启本地 DSH 服务）。
- 桌面通知、主题处理、缩放、窗口状态处理。
- 设置窗口与更新检查（启动后检查新版本）。
- 启动自修复：启动前剥离 profile 里无效的 bundle 条目并重试，再启动 DSH。

窗口里你看到的其余能力（对话、项目、模型/服务商选择、技能、MCP 等）由 DSH 核心或
你在 profile 中启用的插件提供，**不是这个启动器实现的**。

## 从源码构建

需要 Node.js `24.20.0`（随包运行时按此版本校验）与 pnpm。

```powershell
# 一次性安装依赖（同时链接仓库内的插件 workspace）
pnpm install --frozen-lockfile

# 装配随包 node/pnpm + DSH 核心运行时，再产出各平台安装器
pnpm run dist
```

`pnpm run dist` 会先构建随包插件，再跑 `prepare-runtime`（装配随包 Node + pnpm，并把官方
DSH 核心运行时打成 tarball），最后由 electron-builder 把安装器写到 `release\`。

插件与启动器是**一体构建**的：所有出包路径都会先构建插件（`pnpm run build:all`），
且插件产物缺失时打包会**直接报错**，而不是静默产出一个没有桌面设置页的安装包。

本地用固定 Node 24.20.0 构建的辅助脚本是 `scripts/build.ps1`（用 `pwsh` 运行）；
`-Target dist-local` 是快路径，复用已装配的运行时而不重新下载。

`prepare-runtime` 会从 npm registry 下载官方 DSH 运行时与随包插件。默认使用官方
`https://registry.npmjs.org/`，可用环境变量 `DSH_BUILD_REGISTRY` 覆盖——例如官方源
较慢或不可达时指到镜像（如 `https://registry.npmmirror.com/`）：

```powershell
$env:DSH_BUILD_REGISTRY = 'https://registry.npmmirror.com/'
pnpm run dist
```

## 数据与隐私

- DSH 配置、会话与凭据保存在用户的 DSH 目录（Windows 为 `~/.dsh`）。卸载应用不会删除。
- 当前 profile 的选中态保存在应用的用户数据目录
  （`%APPDATA%\DSH My Desktop\profile-registry.json`）。
- 启动器只在内嵌窗口加载经校验的 `127.0.0.1` 回环 HTTP 地址。
- 外部链接由系统浏览器打开；DSH 页面以 Electron 上下文隔离与沙箱运行，Node 集成已禁用。
- 你配置的模型服务商与 DSH 工具可能自行发起网络请求。

## 许可证

[MIT](LICENSE)
