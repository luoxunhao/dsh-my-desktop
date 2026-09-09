# AGENTS.md

DSH My Desktop — Electron 桌面启动器。本文件是给开发/构建 agent 的工具链速查。
**优先用仓库自带的 `scripts/build.ps1` 打包**，它能正确处理下面的 Node/PATH/pnpm 约束。

## 构建入口（推荐）

用仓库里的 `scripts/build.ps1`（用 PowerShell 7 跑，`pwsh`；Windows PowerShell 5.1 也能跑，
但脚本里是 ASCII 输出，避免编码问题）：

```powershell
pwsh -File scripts\build.ps1                  # = pnpm run dist：NSIS 安装器 + zip
pwsh -File scripts\build.ps1 -Target pack     # = electron-builder --dir：win-unpacked 免安装版
pwsh -File scripts\build.ps1 -Target test     # = pnpm test
pwsh -File scripts\build.ps1 -Target prepare-runtime   # 只装配随包运行时
```

`build.ps1` 会自动：
1. 把项目内固定 Node **`.build-node`** 放到 PATH 最前（`prepare-runtime` 校验 Node v24.20.0 版本 + SHA256）；
2. 自动定位 pnpm（当前用户 npm 全局 `%APPDATA%\npm\pnpm.cmd`，再回退 PATH），**不写死任何用户路径**；
3. 在项目根跑 `pnpm run <Target>`。

产物输出到 `release\`（见 `package.json` `build.directories.output`）：`release\dsh-my-desktop-<version>-win-x64.exe`（NSIS）+ `.zip`（便携）。

## 工具链强版本锁定（构建失败的常见原因）

1. **Node 必须是 v24.20.0**（项目随包 Node，`.build-node\node.exe`）。
   `dist/scripts/prepare-runtime.js` 会校验 `process.version` 与随包 node 的 SHA256 是否等于
   `package.json` `config.bundledNodeVersion`/`bundledNodeSha256`。用别的 node（如系统 24.11）会被拒绝：
   `随包 Node 版本不匹配：需要 v24.20.0，实际 v24.xx.x`。
2. **pnpm 必须是 `package.json` 里 `packageManager` 指定的版本**（当前 `pnpm@11.24.0`）。
   用错版本的 pnpm 可能触发 `prepare-runtime` 的 pnpm 版本自检或 `pnpm-workspace`/lockfile 不匹配报错。

`.build-node/` 与 `release/`、`dist/`、`runtime-*` 等都在 `.gitignore`，不会入库。
`.build-node` 若不存在，从 https://nodejs.org/dist/v24.20.0/node-v24.20.0-win-x64.zip 解压到项目根 `.build-node/`。

## PATH 污染（真坑，先排查）

机器 PATH 里可能已有**其它 DSH 发行版**留下的 `...\runtime-commands\bin\pnpm.cmd` 之类失效 shim
（指向不存在的 `E:\.pnpm-store\...`），会让裸 `pnpm`/`node` 解析错乱（报
`ERR_MODULE_NOT_FOUND ... pnpm.mjs`，或命中最前面但不是项目要的 pnpm/node）。
所以**不要裸跑 `pnpm`/`node`**，一律走 `scripts/build.ps1`（它把 `.build-node` 放 PATH 前，
并显式定位 pnpm）。若仍异常，可在干净终端先确认 `where node` / `where pnpm` 命中的是不是项目要的版本。

## 构建过程里的"无害噪音"（不是错误）

- `npm warn Unknown env config "manage-package-manager-versions"` —— npm 的一条无害警告，可忽略。
- `prepare-runtime` 会执行 `npm install --global` 预装整套官方 DSH 运行时（官方预发布 peer 特殊，
  用 npm 而非 pnpm），输出大量 `added N packages` 且较慢、依赖网络——**这是正常的**，别中断。
- 每次 `dist` 都会重跑 `prepare-runtime` 重新装配随包运行时，慢是正常的；只想快速出免安装版用
  `-Target pack`。

## package.json scripts

- `build` = `tsc`（编译到 `dist/`）；`check` = `tsc --noEmit`
- `start` = `build && electron .`（开发运行，不打包）
- `prepare-runtime` = `build && node dist/scripts/prepare-runtime.js`
- `dist` = `prepare-runtime && electron-builder --publish never`（经 build.ps1 跑，pnpm 已由脚本定位正确）
- `pack` = `prepare-runtime && electron-builder --dir`
- `test` = `build && node --test dist/test/*.test.js`

## 与 UI / 顶栏改动相关的关键文件

- `assets/shell.html` —— 主窗口顶部 `.bar`（浅/深两套样式、终端/重启/开发者图标、居中标题）。
  改它不需 `tsc`，dev 从 `assets/` 直接读，重启即生效。
- `src/shell-contract.ts`、`src/shell-preload.cts`、`src/main.ts` —— 顶栏按钮 IPC
  （`dsh-shell:tool` / `dsh-shell:popup-tool`）与 `openDshTerminal` 等实现，改后需 `tsc`。
- `build/installer.nsh` + `build/dsh-path.ps1` —— 安装时把内置 `dsh` 写入用户 PATH
  （在 `$INSTDIR\bin\dsh.cmd` 生成启动器），仅打包安装版生效。
- `scripts/build.ps1` —— 推荐的打包入口（固定 Node/PATH/pnpm）。

## 测试说明（已知的仓库缺口）

`pnpm test` 会跑 `dist/test/*.test.js`。已知有若干用例读 `.github/workflows/desktop-package.yml`，
而本仓库 **没有 `.github/`**，这些用例会因文件不存在（ENOENT）而失败——这是该副本缺 `.github`
导致的已知缺口，不是被测代码的问题。若需要这些 CI 相关用例通过，需补 `.github/workflows/desktop-package.yml`。
