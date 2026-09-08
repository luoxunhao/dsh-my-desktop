<div align="center">

# DSH Desktop

**面向 DeepSeek Harness 的原生桌面启动器。**

[English](README.md) · [更新日志](CHANGELOG.zh-CN.md)

[![许可证](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> DSH Desktop 是 DeepSeek Harness 的社区维护桌面启动器，并非 DeepSeek AI 官方产品。

DSH Desktop 是一个 Electron 应用：它在本地启动一个
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 实例，并把其
Web 界面承载到原生桌面窗口里。安装包自带 Node.js 与一套自包含的 DSH 核心运行时，
打开应用即可使用 DSH，无需自行安装 Node.js，也不必从终端启动。

## 这个项目实际是什么

DSH Desktop 是**启动器 + 桌面壳**。它本身**不实现**对话/工作台 UI。窗口里看到的内容，
来自 DSH 核心（`@deepseek-ai/dsh`）以及你安装进其 `web` profile 的插件。

本版本（0.1.0）：

- 默认不随包任何社区插件（`BUNDLED_PLUGINS` 为空）；
- 在本地经校验的 `127.0.0.1` 回环地址启动 DSH 的 `web` profile（`dsh-base` +
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
| DSH 官方核心运行时（`@deepseek-ai/dsh` 系列，0.1.2-rc.1） | ✅ 是 |
| 社区 / 第三方 DSH 插件 | ❌ 否 |

核心运行时预装且与 profile 隔离，你之后安装的插件不会覆盖随包运行时。

## 首次启动

首次启动时，应用会在 `~/.dsh/profiles/web` 准备官方 `web` profile，**不预装任何社区插件**。

要装插件请自行安装，例如用 DSH CLI 指向本应用的运行时：

```sh
dsh plugin --profile web add <package>
```

**不随包插件市场**。若想在应用内使用市场 UI，请自行把市场类插件（如 `dshmarket`）
装进 profile；应用会向需要的插件暴露安装通道，但本身不随任何市场。

## 桌面壳提供了什么

- 加载本地 DSH Web UI 的桌面窗口。
- 托盘图标与“重新加载”动作（重启本地 DSH 服务）。
- 桌面通知、主题处理、缩放、窗口状态处理。
- 设置窗口与更新检查（启动后检查新版本）。
- 启动自修复：启动前剥离 profile 里无效的 bundle 条目并重试，再启动 DSH。

窗口里你看到的其余能力（对话、项目、模型/服务商选择、技能、MCP 等）由 DSH 核心或
你在 profile 中启用的插件提供，**不是这个启动器实现的**。

## 从源码构建

需要 Node.js `24.20.0`（随包运行时按此版本校验）与 pnpm。

```powershell
# 一次性安装依赖
pnpm install --frozen-lockfile

# 装配随包 node/pnpm + DSH 核心运行时，再产出各平台安装器
pnpm run dist
```

`pnpm run dist` 先跑 `prepare-runtime`（装配随包 Node + pnpm，并把官方 DSH 核心
运行时打成 tarball），再由 electron-builder 把安装器写到 `release\`。本地用固定
Node 24.20.0 构建的辅助脚本是 `scripts/build.ps1`（用 `pwsh` 运行）。

## 数据与隐私

- DSH 配置、会话与凭据保存在用户的 DSH 目录（Windows 为 `~/.dsh`）。卸载应用不会删除。
- 启动器只在内嵌窗口加载经校验的 `127.0.0.1` 回环 HTTP 地址。
- 外部链接由系统浏览器打开；DSH 页面以 Electron 上下文隔离与沙箱运行，Node 集成已禁用。
- 你配置的模型服务商与 DSH 工具可能自行发起网络请求。

## 许可证

[MIT](LICENSE)
