# AGENTS.md

DSH My Desktop — Electron 桌面启动器。本文件是给开发/构建 agent 的工具链速查。
**优先用仓库自带的 `scripts/build.ps1` 打包**，它能正确处理下面的 Node/PATH/pnpm 约束。

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature-slug>/` (GitHub connectivity
is unreliable from the dev environment). See `agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary, unchanged. See `agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `adr/` at the repo root (not `docs/`, which is gitignored).
See `agents/domain.md`.

## 仓库规则：Git 工作流

**直接在 `main` 上开发、提交、推送。不建功能分支，不走 PR。**

- 引用共享目录里的其它项目时同理：改完直接提交，不要另开分支或 PR。
- 仓库历史一直是直提 `main`，这条规则是把既有事实写下来，不是新增约束。

### 每次更新版本：版本号、tag、安装包三者必须同步

**升版本时这三件事是一次动作的三个部分，缺一不可：**

1. **改版本号** —— 两处**必须一起改**，它们必须相等：
   - 根 `package.json` 的 `version`
   - `plugins/dsh-my-desktop-settings/package.json` 的 `version`

   第二处容易漏。物化插件清单（`resolveDesktopSettingsVersion`）读的是插件自身
   的版本，应用版本只是回退值；两者不一致会让设置页显示错版本。

2. **打同名 tag** —— 标注 tag（`git tag -a <version>`），不是轻量 tag。
   标题用 `DSH My Desktop <version>`，正文用中文列出本次改动（对齐 `0.2.0`/`0.2.1`
   的既有格式）。**tag 名必须与 `package.json` 的 `version` 逐字相等**。

3. **出安装包** —— `pwsh -File scripts\build.ps1 -Target dist-local`。
   ⚠️ **不要用 `-Target pack-local` 当作发版**：它只出 `release\win-unpacked\` 免安装
   目录，**不产出 `.exe` 安装器**。曾有整轮修复只跑了 `pack-local`，导致用户装到的
   安装包不含该修复。发版必须跑 `dist-local`（或 `dist`），并确认
   `release\dsh-my-desktop-<version>-win-x64.exe` 的时间戳是本次构建。

提交信息用 `chore(release): ...` 前缀（对齐 `e6ce763`）。

> 历史提醒：`0.3.0` 发布过但当时漏打 tag，事后按 `e6ce763` 补齐；`0.2.0` 的 tag
> 打在了 version bump **之前**（其树内版本号是 `0.1.4`）。这两个都是「没照上面做」
> 留下的坑，别再重犯。

## 向用户提问的强制约定

**任何需要用户做决定的问题，必须用 `ask_user_question` 工具提出，不能写成普通回复。**

用户明确要求过这一点，并已两次因为我在正文里用文字提问而纠正。原因是纯文本提问
不会渲染成可点选的选项，用户只能手打回答，体验差且容易漏答。

硬性要求：

1. **每个问题至少 3 个选项**，不能只给「是/否」或单一方案。
2. **必须有一个推荐选项**，并在该选项的 label 末尾加「（推荐）」。
3. 推荐选项的 `description` 要说明**为什么推荐**（权衡是什么），而不是复述选项本身。
4. 一次可以把**整个 frontier 的问题打包**进一次 `ask_user_question` 调用
   （它接受问题数组），不必一问一停。
5. 问题的 `question` 字段要写足背景——用户在选项界面上看不到我正文里的铺垫，
   关键事实（实测数据、约束、代价）要么写进 `question`，要么写进选项 `description`。

反面例子（已犯过两次，不要重犯）：在回复正文里写
「❓ **Q1** — 标题：问题… ➡️ 推荐 X」，这**不算**提问，用户无法点选。

## 构建入口（推荐）

用仓库里的 `scripts/build.ps1`（用 PowerShell 7 跑，`pwsh`；Windows PowerShell 5.1 也能跑，
但脚本里是 ASCII 输出，避免编码问题）：

```powershell
pwsh -File scripts\build.ps1 -Target dist-local  # 【推荐】缓存优先：只 tsc + 装配插件 + electron-builder，不重下官方运行时
pwsh -File scripts\build.ps1                  # = pnpm run dist：NSIS 安装器 + zip（会重跑 prepare-runtime 重新装配运行时）
pwsh -File scripts\build.ps1 -Target pack-local  # = 缓存优先出 win-unpacked 免安装版
pwsh -File scripts\build.ps1 -Target pack     # = electron-builder --dir（重装配运行时）
pwsh -File scripts\build.ps1 -Target test     # = pnpm test
pwsh -File scripts\build.ps1 -Target prepare-runtime   # 只装配随包运行时
```

> **缓存优先（默认建议）**：日常出包用 `dist-local`/`pack-local`——只 `tsc` +
> 装配私有插件 + `electron-builder`，**不重下官方运行时**（本地 `runtime-dsh`/`runtime-dsh.tgz`
> 版本一致即复用，见 `prepare-runtime.ts` 的 `officialRuntimeIsCurrent`）。仅当升官方 DSH 版本或
> 运行时配置变更时才需要 `DSH_FORCE_RUNTIME_REBUILD=1` 或走完整 `dist`。
> `build.ps1` 默认给 electron-builder 指到可访问的镜像源（`ELECTRON_MIRROR`、
> `ELECTRON_BUILDER_BINARIES_MIRROR` 指 npmmirror），避免直连 GitHub 拉不动的 winCodeSign/nsis 等工具。

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

- `build` = `tsc`（只编译启动器到 `dist/`）；`check` = `tsc --noEmit`
- `build:plugin` = `pnpm --dir plugins/dsh-my-desktop-settings run build`；`check:plugin` = 同目录 `typecheck`
- `settings:install` = 构建设置插件并装进 per-user 版本存储（本机直装，不出安装包）
- **`build:all` = 插件 → 启动器 → 恢复页 → 扁平发布单元**（一体化的默认构建入口）；
  `check:all` = 插件 + 启动器 + 恢复页 三处一起 typecheck
- `build:recovery-ui` = `vite build`（恢复页前端）；`check:recovery-ui` = `tsc -p tsconfig.recovery-ui.json`
- `start` = `build:all && electron .`（开发运行，不打包）
- `prepare-runtime` = `build:all && node dist/scripts/prepare-runtime.js`
- `dist` = `prepare-runtime && electron-builder --publish never`（经 build.ps1 跑，pnpm 已由脚本定位正确）
- `pack` = `prepare-runtime && electron-builder --dir`
- `test` = `build:all && node --test dist/test/*.test.js`
  （**必须走 `build:all`**：测试会断言 `dist/bridge-flat/` 与 `dist/extract-flat/` 里的暂存产物，
  而 `dist/` 是 gitignore 的。用 `build` 会让这些断言在干净 clone / CI 上失败。）
- `build:flat` = 扁平化两个「扁平发布单元」（bridge 15 个 + extract 3 个）到
  `dist/bridge-flat/`、`dist/extract-flat/`；`build:all` 已包含这一步
- `dist:local` / `pack:local` = `build:all` + `--stage-plugin` + 打包（**日常出包走这个**；
  发版必须用 `dist:local`，见上文「Git 工作流」）

> **一体化构建**：插件是启动器的定制设置页，所有出包路径最终都会构建它
> （`dist`/`pack` 经 `prepare-runtime` → `build:all`）。`test/prepare-runtime.test.ts` 里有一条
> 用例递归展开 `pnpm run` 链来守住这个约束——**新增出包脚本时别忘了让它最终走到插件构建**。
> 插件产物缺失时 `stageDesktopSettingsPlugin()` 会**直接抛错**而不是警告跳过，
> 避免产出一个设置页消失、却看起来正常的安装包。

## 随包私有插件：`plugins/dsh-my-desktop-settings`

桌面设置插件（包名仍为 `dsh-my-desktop-setting`）是 DSH My Desktop 的**定制插件**，
源码就在本仓库 `plugins/dsh-my-desktop-settings/`，随 desktop 一起构建、一起发布，**不单独发 npm**。

- 它是 pnpm workspace 成员（根 `pnpm-workspace.yaml` 的 `packages: [plugins/*]`），
  根目录 `pnpm install` 会一并装好它的依赖；**不要**在该子目录里单独 `pnpm install`
  （子目录没有自己的 `pnpm-workspace.yaml`/lockfile）。
- 构建：`pnpm run build:plugin` → 产出 `plugins/dsh-my-desktop-settings/lib/{index.js,client.js}`。
  `lib/` 是构建产物（已 gitignore），只在打包时装配。
- 装配：`scripts/prepare-runtime.ts` 的 `stageDesktopSettingsPlugin()` 把 `lib/` +
  `package.json` 拷到 `dist/desktop-settings-plugin`，再由 `package.json` 的 `extraResources`
  落到安装包的 `resources/dsh-my-desktop-setting/`。
- 它只依赖 `@deepseek-ai/dsh-client-*` 的**类型**（运行时 externals 由 client module table 提供）。
  版本对齐用的 tarball 在 `plugins/dsh-my-desktop-settings/vendor/<dsh-version>/`，**需入库**。

### 插件不装进任何 profile（重要）

插件**不写入** profile 目录（不进 `dsh.profile.bundles`、不进 profile 的 `node_modules`）。
它每次启动时以 `--patch` overlay 注入**当前选中的 profile**：

```
node bootstrap.mjs <dsh> --profile <当前profile> --patch <bridge.patch.yml> --patch <settings.patch.yml> --port 0 --no-open
```

- **物化位置**：`%APPDATA%\DSH My Desktop\desktop-settings-plugin\`（每用户一份，与 profile 无关），
  由 `src/desktop-settings-plugin.ts` 的 `prepareDesktopSettings()` 在每次启动时覆盖写入。
- **跟随 profile**：因为不是"装在某个 profile 里"，切到任何 profile（`web`/`desktop`/自建）
  插件都在，无需重装。
- **为什么不用 `dsh.profile.bundles`**：不是因为代码会拒绝私有包——实测过，
  `reconcileProfileBundles`/`pruneMissingProfileBundles`/`finalizeProfileBundlesAfterInstall`
  都会保留它，直接当 profile bundle 装也能启动（真实原因是**生命周期归属**：profile
  是用户可建/删/切、且市场可禁用包的地方，而桌面设置页是启动器自身的 UI，必须在**任何**
  profile（包括刚新建的）里都在。装在 profile 里 ⟹ 新建 profile 就没设置页。）
- **可独立升级（不用重出 300 MB 安装包）**：插件装在 per-user **版本存储**
  `%APPDATA%\DSH My Desktop\desktop-settings-plugin\<version>\`，启动时按 SemVer
  选最高版本（见 `src/bridge/desktop-settings-store.ts`）。overlay row 的 `file:` URL
  指向**选中的版本目录**，所以换版本不需要 ESM resolver hook（dsh-desktop 需要 hook
  是因为它按裸包名从两个 root 解析）。
  - 随包那份每次启动都 seed 进存储（版本相同则刷新内容），因此**只有装更高版本才会
    生效**；装更低或相同版本不会盖掉随包那份。回滚 = 删掉新版本目录。
  - 本机改完设置页想立刻看到：
    ```powershell
    pnpm run settings:install        # 构建 + 装进版本存储（--dry-run 只看不装）
    ```
    然后**完全退出应用再启动**。这**只影响本机**：分发给别人仍要出安装包，
    因为随包那份才是基线。
- **物化清单的版本**读插件自身 `package.json`（`resolveDesktopSettingsVersion`），
  缺失/损坏时回退到应用版本——**不要写死版本号**，否则随发布漂移。

### 桌面桥（`desktop-bridge`）暴露的 ctx 服务

`src/desktop-bridge.mts` 在 `ctx.root` 上 provide 三个服务（只注册一次；
注册到 entry ctx 会因 Cordis 作用域隔离而不可见）：

- `desktopProfiles` —— profile 列/建/删/选（真实读写 `<DSH_HOME>/profiles` + userData 注册表）
- `desktopPnpm` —— 真实 pnpm 桥
- `desktopRuntime` —— 重启 / 开终端 / 开发者工具

子进程 ↔ Electron main 经 `process.send` IPC 请求/应答（带 requestId）。
**建/删 profile 的耗时差异很大**：create 要 seed（pnpm 装依赖，可能几十秒），
select 近乎瞬时，所以超时按操作类型分别设置，且**永不挂死 HTTP 响应**。

## 多 profile 模型

启动器不再写死单 profile：**profile 是受管对象，可列/建/删/选**。

- **磁盘布局**：`<DSH_HOME>/profiles/<name>/`（默认 `DSH_HOME=~/.dsh`）。
- **选中态**：`%APPDATA%\DSH My Desktop\profile-registry.json`（`{version:1, active}`），
  由 `src/profiles/profiles.ts` 的 `readActiveProfile`/`writeActiveProfile` 维护；缺失或损坏时回退
  `DEFAULT_PROFILE_NAME = 'dsh-my-desktop'`（0.3.0 起由 `web` 改为它，无迁移：已记录
  `"active": "web"` 的老安装继续用 `web`）。
- **API**：`listProfiles` / `createProfileDirectory` / `deleteProfileDirectory` /
  `profileDirFor` / `resolveProfileRoots` / `isSafeProfileName`（`src/profiles.ts`）。
- **启动**：`main.ts` 读 active → `--profile <activeName>` 启动 DSH 子进程。
  ⚠️ **必须用 `--profile`**：DSH CLI 的裸 `web` 子命令是 `--profile web` 的硬编码别名，
  只会启动 `web`，会忽略所选 profile。
- **删除是移到回收站**（trash-move），不是直接 unlink；当前 active profile 不可删。
- **切换需要重启**：改注册表后走 `restartDesktop()` 重启整代。
- 新增 profile 首次启动要 seed（pnpm 装依赖），**较慢是正常的**。

## 与 UI / 顶栏改动相关的关键文件

**所有 UI 代码都在 `frontend/`**，两处：`frontend/shell/`（5 个启动器窗口）与
`frontend/recovery/`（恢复页）。源码不再散落在 `src/` 与 `assets/`。
产物落 `dist/frontend/{shell,recovery}/`，打包后落 `resources/frontend/{shell,recovery}/`。

- **`frontend/shell/`** —— 主窗口顶栏 + 关于 / 快捷键 / 设置 / 启动页
  （React + 手写 CSS，无 Tailwind）。改后必须 `pnpm run build:shell-ui`
  （`build:all` 已含此步），否则窗口读的还是旧产物。
- **`frontend/recovery/`** —— 恢复页前端（React + Vite + Tailwind + `@base-ui/react`）。
  改后必须跑 `pnpm run build:recovery-ui`（`build:all` 已含此步）。

两个前端共有的**硬约束**（踩过，别再踩）：

1. **产物必须是经典脚本（IIFE），不是 ES module**。窗口用 `loadFile` 以 `file://` 加载，
   而浏览器拒绝从 `file://` 文档执行 module 脚本——症状是**窗口一片空白、控制台无报错**。
   两个 Vite 配置里的 `format: 'iife'` 与构建后插件（去掉 `type="module"`/`crossorigin`）正是为此。
   推论：`iife` 隐含 `codeSplitting: false`，而 Vite 8 (Rolldown) 拒绝 IIFE 多入口，
   所以 shell 的 5 个窗口由 `scripts/build-shell-ui.mjs` **逐个**构建（`DSH_SHELL_ENTRY` 选择）。
2. **挂载必须等 DOM 就绪**。经典脚本在 `<head>` 中会早于 `<body>` 执行，
   裸的 `getElementById('root')` 会返回 null 并抛错。这个坑已被踩过两次。
3. **tsconfig 用 `moduleResolution: 'bundler'`**（主 tsconfig 是 NodeNext），
   因此组件里的 import **不带扩展名**；跨出 `frontend/` 引用 `src/` 时按相对路径写
   （如 `../../src/desktop/shell-contract.js`）。
4. **主题**：两个前端都以 `:root[data-color-scheme="light"|"dark"]` 为准，该属性由
   HTML 里的首屏同步脚本（读 `?theme=`）设置，React 侧再用 `applyColorScheme` 跟随运行时切换。
   **漏掉任一侧就会固定成默认主题**（顶栏曾一直深色、恢复页曾一直浅色）。

改完记得 `pnpm run check:all`（含 shell-ui 与 recovery-ui 两处 typecheck）。

- `src/desktop/shell-contract.ts`、`src/shell-preload.cts`、`src/main.ts` —— 顶栏按钮 IPC
  （`dsh-shell:tool` / `dsh-shell:popup-tool`）与 `openDshTerminal` 等实现，改后需 `tsc`。
- `build/installer.nsh` —— NSIS 安装脚本。安装/卸载阶段**不**做任何同步子进程或改用户 PATH
  的工作（曾因 `nsExec` 调 powershell 写 PATH 而永久卡死，故已移除）；运行时由应用首次启动解压。
- `src/main.ts` 的 `openDshTerminal` —— 打开 DSH 终端：在 userData 生成 `dsh` shim 并只注入到该终端
  进程的 PATH（不动系统 PATH），对齐 `dsh-desktop` 的做法。
- `scripts/build.ps1` —— 推荐的打包入口（固定 Node/PATH/pnpm）。

## 改完代码后怎么让正在跑的应用生效

安装版**不读仓库**，它读两份副本，容易踩坑：

1. `D:\Program Files\DSH My Desktop\resources\` —— 安装目录（**需 UAC 提权**才能写）。
2. `%APPDATA%\DSH My Desktop\` —— 物化副本（**运行中的应用实际读的是这份**：
   `desktop-bridge\` 与 `desktop-settings-plugin\`）。

`scripts/stage-installed.ps1` 把 `release\win-unpacked\resources` 同步到这两处（需提权运行）：

```powershell
Start-Process pwsh -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','E:\project\dsh\dsh-my-desktop\scripts\stage-installed.ps1'
```

- 该脚本只覆盖 `lib/` 与 `cordis.patch.yml`：物化目录有自己的 `package.json`，
  构建产物树里没有，整树覆盖会把它删掉。
- **改完必须完全重启应用**：单实例锁会让第二次启动无效，且进程内已加载旧代码。
- 更省事的办法是直接装 `release\dsh-my-desktop-<version>-win-x64.exe` 覆盖安装。

## 测试说明（已知的仓库缺口）

`pnpm test` 会跑 `dist/test/*.test.js`。已知有 4 条用例读 `.github/workflows/desktop-package.yml`，
而本仓库 **没有 `.github/`**，这些用例会因文件不存在（ENOENT）而失败——这是该副本缺 `.github`
导致的已知缺口，不是被测代码的问题。若需要这些 CI 相关用例通过，需补 `.github/workflows/desktop-package.yml`。

当前基线是 **536 项 / 531 通过 / 4 失败**（全部为上述 `.github` 缺口）。

> 注意 `dsh-process.test.ts` 的「重复关闭同一 DSH 子进程是安全的」在整包并发跑时**偶发**超时
> （单独跑 3/3 通过）。看到它失败先单独复跑一次再判断，不要当成回归。
