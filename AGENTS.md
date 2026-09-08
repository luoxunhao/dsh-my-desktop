# AGENTS.md

DSH My Desktop — Electron 桌面启动器打包与开发环境速查。

## 关键约束（构建失败时先查这里）

本项目对构建工具链有**强版本锁定**，用错版本会直接报错或产生诡异失败。
构建与运行时装配（`prepare-runtime`）必须满足下面两条，否则 `pnpm run dist`
会因为「pnpm 版本自检」或「随包 Node 校验」提前失败：

1. **Node 必须是 v24.20.0**（即仓库自带的随包 Node）。
   - 路径：`.build-node\node.exe`。
   - `dist/scripts/prepare-runtime.js` 会校验 `process.version === '24.20.0'`
     以及该 node 的 SHA256 与 `package.json` 的 `config.bundledNodeSha256` 一致，
     任何其它 node（例如系统装的 v24.15.0）都会被拒绝。
2. **pnpm 必须是 11.24.0**（`packageManager: pnpm@11.24.0`）。
   - 直接使用 `pnpm run dist` 有坑：脚本内部会再次调用裸 `pnpm`，
     corepack 会把它解析成 11.8.0，触发版本自检失败
     （`This project is configured to use 11.24.0 of pnpm...`）。
   - 可靠做法：绕过嵌套脚本，用 corepack 的 pnpm 11.24.0 入口直接跑底层命令
     （见下方「可用的打包步骤」）。

### PATH 污染警告
用户机器 PATH 里可能已有其它 DSH 发行版的 `...\runtime-commands\bin\pnpm.cmd`
（一个指向 `E:\.pnpm-store\...` 的、失效的 pnpm 11.24.0 shim），会让裸 `pnpm`
/ `node` 解析错乱（如报 `ERR_MODULE_NOT_FOUND ... pnpm.mjs` 或用错 node 版本）。
**执行任何构建命令前，把 `.build-node` 放到 PATH 最前。**

## 可用的打包步骤（已在真机验证此序列能跑通 prepare-runtime 装配）

不依赖 `pnpm run dist` 的嵌套 pnpm，直接用固定工具逐条执行：

```powershell
$node  = 'E:\project\dsh\dsh-my-desktop\.build-node\node.exe'
$root  = 'E:\project\dsh\dsh-my-desktop'
Set-Location $root
# 让裸 node / pnpm 优先命中随包工具，避开系统 node 与失效的 pnpm shim
$env:PATH = 'E:\project\dsh\dsh-my-desktop\.build-node;' + $env:PATH
# 让 prepare-runtime 内部用到 pnpm 时命中正确的 11.24.0
$env:npm_execpath = 'C:\Users\luoxh\AppData\Local\node\corepack\v1\pnpm\11.24.0\bin\pnpm.cjs'

# 1) 编译 TypeScript -> dist
& $node 'node_modules\typescript\bin\tsc'
# 2) 装配随包 Node + 预装官方 DSH 运行时（会执行 npm 全局安装，较慢，依赖网络）
& $node 'dist\scripts\prepare-runtime.js'
# 3) electron-builder 出安装包（win -> NSIS + zip）
& $node 'node_modules\electron-builder\out\cli\cli.js' --publish never
```

说明：
- corepack pnpm 11.24.0 入口路径在装有 corepack 的机器上通常是
  `%LOCALAPPDATA%\node\corepack\v1\pnpm\11.24.0\bin\pnpm.cjs`；
  若不存在先执行 `corepack pnpm@11.24.0 --version` 让它落盘。
- `prepare-runtime` 会执行 `npm install --global` 预装整套 DSH 官方运行时
  （官方预发布包 peer 依赖特殊，只能用 npm 而非 pnpm），可能耗时很长且依赖网络。
- 打包产物默认输出到 `release/`（见 package.json `build.directories.output`）。

## 常用脚本（package.json scripts）
- `build` = `tsc`；`check` = `tsc --noEmit`
- `start` = `build && electron .`（开发运行，不打包）
- `prepare-runtime` = `build && node dist/scripts/prepare-runtime.js`
- `dist` = `prepare-runtime && electron-builder --publish never`（注意：内部嵌套 pnpm，见上）
- `pack` = `prepare-runtime && electron-builder --dir`

## 与 UI / 顶栏改动相关的关键文件
- `assets/shell.html` —— 主窗口顶部 `.bar`（浅/深两套样式、左侧终端/重启/开发者图标、
  居中标题）。改它不需 tsc，重启即生效（dev 从 `assets/` 直接读）。
- `src/shell-contract.ts`、`src/shell-preload.cts`、`src/main.ts` —— 顶栏按钮 IPC
  （`dsh-shell:tool` / `dsh-shell:popup-tool`）与 `openDshTerminal` 等实现，改后需 `tsc`。
- `build/installer.nsh` + `build/dsh-path.ps1` —— 安装时把内置 `dsh` 写入用户 PATH
  （在 `$INSTDIR\bin\dsh.cmd` 生成启动器），仅打包安装版生效。
