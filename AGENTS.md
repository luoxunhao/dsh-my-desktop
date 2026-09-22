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

   ⚠️ **若本次同时升了随包 DSH 运行时，必须先单独跑一次 `prepare-runtime`**：
   `dist-local` 不会重装官方运行时，直接出包会得到"版本号是新的、运行时是旧的"的包。
   详见「升级随包 DSH 运行时」一节。
   出包后务必按「出包后必须校验」一节从包内解出运行时版本核对。

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

用仓库里的 `scripts/build.ps1`（**只能用 PowerShell 7 跑，即 `pwsh`**）：

```powershell
pwsh -File scripts\build.ps1 -Target dist-local  # 【推荐】缓存优先：只 tsc + 装配插件 + electron-builder，不重下官方运行时
pwsh -File scripts\build.ps1                  # = pnpm run dist：NSIS 安装器 + zip（会重跑 prepare-runtime 重新装配运行时）
pwsh -File scripts\build.ps1 -Target pack-local  # = 缓存优先出 win-unpacked 免安装版
pwsh -File scripts\build.ps1 -Target pack     # = electron-builder --dir（重装配运行时）
pwsh -File scripts\build.ps1 -Target test     # = pnpm test
pwsh -File scripts\build.ps1 -Target prepare-runtime   # 只装配随包运行时
```

⚠️ **不要用 Windows PowerShell 5.1（`powershell`）跑它**：脚本里有中文注释，而文件是
**无 BOM 的 UTF-8**，5.1 会按本地代码页（GBK）解码，多字节序列被切碎后**在解析阶段就失败**
（`字符串缺少终止符`、`Try 块缺少 Catch 或 Finally` 等一连串报错），根本没走到构建那一步。
实测于 2026-09-19：`powershell -File scripts\build.ps1 -Target check` 全红，与源码无关，
别把它当成被测代码的回归。PowerShell 7 默认按 UTF-8 读，所以只有 `pwsh` 能跑。

在 Git Bash / 无人值守会话里 `pwsh` 常常**不在 PATH 上**（`command -v pwsh` 为空），但安装是在的：
用完整路径 `C:\Program Files\PowerShell\7\pwsh.exe`。若只想验证源码树完整、又不想生成 `dist/`
产物（例如刚清理完产物之后），可以直接用随包 Node 跑类型检查：
`./.build-node/node.exe ./node_modules/typescript/bin/tsc --noEmit`。

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

## 构建耗时：慢在哪、怎么变快（实测数据）

**先记住这个反直觉的结论：源码编译只占几秒，"慢"几乎永远出在装配/打包阶段。**
以下为本机实测（0.8.0 那轮，热缓存）：

| 阶段 | 耗时 | 说明 |
| --- | --- | --- |
| `build:all` 全量（插件 + tsc + 两个前端 + 扁平化） | **~5.6s** | `build:plugin` 2.2s / `build` 0.7s / `recovery-ui` 0.8s / `shell-ui` 1.6s / `build:flat` 0.3s |
| `prepare-runtime --stage-plugin`（热） | **~11s** | 只装配插件 store + 设置插件 |
| 同上（冷，store 缓存被清/缺失） | **~290s** | 同一命令、同一机器，**20× 差距** |
| `electron-builder --dir`（win-unpacked） | **~17s** | 写出 766 MB |
| 单次 `pnpm run` 自身开销 | **0.3s** | 与 `node` 直跑（0.1s）几乎无差，不是瓶颈 |

所以遇到"奇慢"，按这个顺序排查：

1. **是不是冷装配**（最常见的 290s 来源）。`runtime-plugins/store/{v11,cache}` 是 pnpm 的
   内容寻址仓库与元数据缓存，合计约 **410 MB**；这两个目录在就 `~11s`，被删掉就回到
   "重下整套插件依赖"的几百秒。`prepare-runtime` 的 `wipePreparedDirectoryKeepingCache`
   就是为保住它们而存在的——**不要手工删 `runtime-plugins/`**。
   注意 `store.tgz` 仍每次出包都从一次 install 重新打包（"插件清单变了 store 必须重建"
   这条硬约束没有松动），保住的只是缓存。
2. **`release/` 无限累积**。实测 `release/` 到 **7.1 GB / 640 个文件**（十几个历史版本的
   exe+zip+blockmap 叠在一起）。`electron-builder` 每次要重写 `release\win-unpacked`（766 MB），
   目录越大、杀软扫描与文件枚举越慢。**发布完成后按需清理历史版本产物**（保留当前版本即可）。
3. **`runtime-dsh` 走完整重装**。只有升官方 DSH 版本或运行时配置变更才需要，见下节；
   日常出包用 `dist-local`/`pack-local` 不该触发它。
4. **冷 `node_modules`**。`pnpm install` 在 lockfile 与 manifest 不一致时会重建整棵树
   （实测 376 包、热缓存 2.5s；冷则数分钟，且见过挂死，见下节）。

## 升级随包 DSH 运行时（升版本必读，有一个静默陷阱）

> ⚠️ **`dist:local` / `pack:local` 不会重装官方运行时。**
> 它们走 `prepare-runtime.js --stage-plugin` 快路径，而该分支只调
> `stageDesktopSettingsPlugin()` + `stagePluginStore()`，**从不调用 `main()`**
> （见 `scripts/prepare-runtime.ts` 末尾）。推论：**`DSH_FORCE_RUNTIME_REBUILD=1`
> 在这条路径上完全无效**——它只在 `main()` 里被读。
> 照这样直接出包，会得到一个**版本号是新的、里面却还是旧运行时**的安装包，而且
> 构建全绿、毫无报错。0.8.0 那轮踩到过一次，已在出包后校验时发现并重做。

正确的升级顺序（把"重装运行时"与"出包"分成两次调用）：

```powershell
# 1) 先单独重建官方运行时（走 main()，会联网；只有这一步需要 FORCE）
$env:CI='true'                       # 让 pnpm 不因无 TTY 而拒绝清理 modules 目录
$env:DSH_FORCE_RUNTIME_REBUILD='1'
pwsh -File scripts\build.ps1 -Target prepare-runtime

# 2) 确认运行时真的换掉了（不要跳过）
Get-Content runtime-dsh\node_modules\@deepseek-ai\dsh\package.json | Select-String version

# 3) 再出包（此时官方运行时已是最新，dist-local 正确复用）
Remove-Item Env:\DSH_FORCE_RUNTIME_REBUILD
pwsh -File scripts\build.ps1 -Target dist-local
```

⚠️ **上面第 1 步必须从 Git Bash 里补 PATH 再跑**：`packDirectoryToTarGz`/`extractTarGz` 裸调
`tar`（`src/infra/runtime-archive.ts`），而从 Git Bash 启动的 `pwsh` 会继承 MSYS 的 GNU tar，
它不认 `E:\...` 盘符（当成 `host:path`）⟹ **打包步骤在 `tar -czf runtime-dsh.tgz` 上炸
`Cannot connect to E: resolve failed`，而这一步在整条链的最后**，前面几百秒的联网装配全部白做。
先 `export PATH="/c/Windows/System32:/c/Windows:$PATH"`，用 `tar --version` 确认是 bsdtar。
（`-Target test` 的同类假失败见「测试说明」，同一个根因。）

⚠️ **`DSH_FORCE_RUNTIME_REBUILD=1` 连插件 store 缓存一起清**（`prepare-runtime.ts` 的
`if (forceRuntime) removePreparedPath(pluginRoot)`）——下一次装配社区插件必然是冷启动（实测
~290s 那档）。0.8.4 这轮它还暴露了另一件事：`plugins-store.tgz` 从 126 MB 掉到 34 MB、成员从
17,518 项掉到 6,333 项，**看着像洗掉历史垃圾，实际同时洗掉了运行时要用的那套 registry 元数据键**
（见下一节）。两件事混在同一个数字里，光看体积分辨不出来。

⚠️ **压缩包与运行时目录是两份状态，判据只看目录**：`officialRuntimeIsCurrent()` 只读
`runtime-dsh/node_modules/**/package.json` 的版本，**不看 `runtime-dsh.tgz`**；而
`runtimeCurrent` 为真时整段打包（含 `packDirectoryToTarGz`）被跳过。于是"目录已是新版本、
压缩包还是旧版本"会一路全绿出包。要么按上面第 2 步核对，要么直接删掉 `runtime-dsh.tgz`
逼它重打包——出包后从包内解出来验版本是唯一能证明这件事的检查（见「出包后必须校验」）。

升运行时还要同步下面这些（漏一处要么构建期报错、要么静默漂移）：

- `src/runtime/bundled-plugins.ts` 的 `OFFICIAL_DSH_VERSION`（`OFFICIAL_RUNTIME` 与三个
  launch peer 都由它派生，**只改这一处**）；`package.json` 的 `config.bundledDshVersion`。
- 插件 4 个 client 类型 tarball 重新入库到 `plugins/dsh-my-desktop-settings/vendor/<version>/`，
  并同步该插件 `package.json` 里 4 条 `file:` devDependencies。
- `pnpm-lock.yaml`：这 4 条 `file:` 的 specifier / resolution / snapshot 键与 `integrity`
  都要跟着改（`integrity` 是 `sha512-` + base64(sha512(tarball 字节))，可实测重算核对）。
- 精确版本字面量的测试断言：`test/bundled-plugins.test.ts`、`test/prepare-runtime.test.ts`。

**选版本的依据**：官方家族按"同一个精确版本"锁死，所以要挑一个**全家族都发布过**的号。
查 dist-tag 别用 `npm view`（本机 npm 缓存目录在沙箱外，会报 `EPERM`），直接取 registry：

```powershell
.\.build-node\node.exe -e "fetch('https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags').then(r=>r.json()).then(console.log)"
```

坑在于 `latest` 未必是你要的：0.8.0 时家族所有包的 `latest`/`next` 都停在 `0.1.5-rc.2`，
**只有 `alpha` 指向 `0.1.6-alpha.2`**。另外三个 launch peer 的 `latest` 长期停在古老的
`0.0.1-rc.1`——按各自 `latest` 装会把 peer 降级、破坏家族锁版本，**必须统一跟同一个号**。
例外：`@deepseek-ai/cordis-plugin-group` 单独钉在 `1.0.2`，不随家族走。

## 出包后必须校验（版本号/运行时都可能静默不对）

构建退出码 0 不等于包是对的。至少做这两项：

```powershell
# 1) 安装包确实是本次构建（时间戳 + 文件名版本）
Get-ChildItem release\dsh-my-desktop-*-win-x64.exe | Select-Object Name,LastWriteTime

# 2) 端到端：从**安装包内**的 dsh-runtime.tgz 解出真实运行时版本
$tmp = ".scratch\verify"; Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
tar -xzf release\win-unpacked\resources\dsh-runtime.tgz -C $tmp "node_modules/@deepseek-ai/dsh/package.json"
(Get-Content "$tmp\node_modules\@deepseek-ai\dsh\package.json" -Raw | ConvertFrom-Json).version
```

第 2 条是唯一能证明"运行时真的换掉了、不是复用了旧缓存"的检查；`dist-local` 的静默陷阱
只有它会暴露。

### 第 3 条：离线首启冒烟（单元测试全绿也照样能坏）

```powershell
pwsh -File scripts\smoke-package.ps1 -ApplicationPath "release\win-unpacked\DSH My Desktop.exe"
```

它用临时 `DSH_HOME`/`userData` + `pnpm_config_offline=true` 真起一次应用，再校验随包插件是否
补种到位。**只有这条能同时验到两件事**：DSH 子进程接不接受启动器注入的 `--patch`（0.8.2 的
裸包名挂载就是它抓出来的），以及随包插件 store 能不能**离线**解析（下面这条坑）。

### 随包 store 的离线元数据按 registry 域名分键（0.8.4 实测）

`build.ps1` 默认把 `DSH_BUILD_REGISTRY` 指到 `registry.npmmirror.com`。pnpm 的版本元数据落在
`<store>/cache/v11/metadata/<registry 域名>/<包>.jsonl`，而**运行时补种用的是 `buildRegistry()`
的默认值 `registry.npmjs.org`**（应用进程里没有那个环境变量）。于是走一次
`DSH_FORCE_RUNTIME_REBUILD=1` 之后装配出来的 store 只有 npmmirror 那套键 ⟹ 首启离线补种报
`ERR_PNPM_NO_OFFLINE_META`，5 个社区插件一个都装不上。非 FORCE 路径因为 `cache/` 跨版本累积、
两种键都在，所以这个坑平时不显形——0.8.3 那份 store 就是两种键都有的。

**0.8.5 起这条由 `stageBundledPlugins` 自动处理**：装配完镜像源那遍之后，若
`buildRegistry() !== OFFICIAL_NPM_REGISTRY`，再对官方源跑一遍 `--lockfile-only`（只取元数据、
不下 tarball，实测几百毫秒到几十秒），于是包里的 store 两套键都有。改这段前先确认
`test/prepare-runtime.test.ts` 那条源码模式断言还在。

- **看这一眼就知道有没有坏**：`ls runtime-plugins/store/cache/v11/metadata/` 必须同时有
  `registry.npmjs.org` 与构建用的那个镜像域名。
- **清单清空时**（`STORE_PACKAGES.length === 0`）整段 store 装配跳过，`package.json` 里那两条
  `plugins-store` 的 `extraResources` **必须一起删**，否则 electron-builder 因源文件不存在硬失败；
  反过来，清单非空却漏了这两条 ⟹ 首启静默不预装（`test/prepare-runtime.test.ts` 钉的是
  "清单非空 ⇒ 必须带上"）。


## Linux / 信创适配现状（2026-09-21 WSL2 实测）

结论：Linux x64 这条路**能走通**（`prepare-runtime` → `electron-builder --linux deb` → 冒烟通过，首启 3.4 秒），
而且**glibc 2.28 那一格已用 Debian 10 chroot 补掉**。但它仍是一次性验证：没有构建脚本，也没在信创真机
（UOS/DDE 桌面）上跑过。下面几条是实测出来的前提。

- **glibc 门槛是压线过的，且已在 2.28 上真跑通。** 扫 ELF 的 `GLIBC_2.xx` 符号版本：Electron 44.1.1
  linux-x64 主二进制最高只到 `GLIBC_2.25`（`chrome-sandbox` 到 2.4），但**随包 Node v24.20.0 linux-x64
  到 `GLIBC_2.28`**。统信 UOS V20（Debian 10 派生、kernel 4.19）正好是 glibc 2.28 ⟹ 能过但零余量；
  银河麒麟 V10 是 2.31。随包 Node 的 linux-x64 SHA256 与 `config.bundledNodeSha256["linux-x64"]` 已核对相等。
  随后在 **Debian 10 buster chroot（`Debian GLIBC 2.28-10+deb10u1`）**里 `dpkg -i` 本次出的 deb 并首启成功：
  第二次启动到 ready 4 秒（DSH 子进程 `ready total=1791ms`、健康检查 29ms），根页面返回契约内的
  `401 dsh web authentication required`，离线补种 4 个随包插件到位。
- **原生依赖按构建机平台装配，交叉打包必坏。** Windows 上跑 `prepare-runtime` 得到的 `runtime-dsh/`
  里是 `@img/sharp-win32-x64`、`@koromix/koffi-win32-x64`、`node-addon-require-builtin-win32-x64-msvc`、
  `libreoffice-kit-win32-x64`（后者是体积大头）；Linux 上装出来的才是 `*-linux-x64` 一族。
  所以**出 Linux 包必须在 Linux 上跑完整 `prepare-runtime`（走 `main()`）**，`dist:local` 的缓存优先
  会把 Windows 那套原样复用进 Linux 包。
- **`runCurrentNpm` 要求 Node 是完整发行版。** 它只在 `dirname(execPath)/node_modules/npm` 与
  `prefix/lib/node_modules/npm` 两处找 npm。把随包 Node 拷成单文件（`.build-node/node`）时两处都没有
  ⟹ 官方运行时装配报「未找到当前 Node 附带的 npm CLI」。
- **browser use 在非 win32 不探测系统浏览器**（`chromiumCandidatePaths()` 直接返回 `[]`），overlay 照样
  挂但不写 `executablePath`，退回 playwright 的每用户缓存发现。**缺的不是代码路径而是"机器上得有浏览器"**：
  实测在 Linux 上用 provider 的同一套参数（`cli.js --browser chromium --isolated --headless`）跑通了
  navigate / snapshot / evaluate（`HeadlessChrome/153.0.0.0`），只要 `~/.cache/ms-playwright` 里有
  chromium 就能用；显式传 `--executable-path` 同样有效。全新信创机器既探不到系统浏览器、也没有那份缓存，
  所以首次使用即失败。UOS 上常见的是奇安信/360/火狐，也不是 `chrome.exe` 那套目录布局。
- **冒烟走的是 `--no-sandbox`。** 真机要么由 deb 的 postinst 把 `chrome-sandbox` 设成 root:root 4755，
  要么放开非特权 user namespace。AppImage 不设 setuid，所以信创首选 deb。
- 测试基线（Linux）：`dist/test/*.test.js` 551 项 / 545 通过 / 4 失败 / 2 跳过——4 条失败仍是缺
  `.github` 那几条，与 Windows 一致。

## pnpm install 会挂死（真坑，先别急着重跑）

实测过一次：`pnpm install` 在 lockfile 与 manifest 不一致、需要整树重建时**挂死**——
12 分钟里 CPU 持续满载（最终累积 2797s）却**零进展**：`.pnpm` 目录数两个采样点都是 384，
新建的包目录全是**空壳（0 文件 / 0 MB）**，store 的 `.tmp` 里没有任何解包产物。
即症状是"看着在忙、其实什么都没做"，不是网速慢。这会把 `node_modules` 掏空
（顶层只剩 `.pnpm` 与几个元数据文件），必须修好 lockfile 后重装。

处置与预防：

- **先让 lockfile 与 manifest 一致，再 install**。顺序反了（先改 `package.json` 的依赖、
  锁文件还旧）就会走到重建路径。只想校验 lockfile、不动 `node_modules`：
  `pnpm install --frozen-lockfile --lockfile-only`（几秒）。
- **务必设 `CI=true`**：否则 pnpm 会因无 TTY 直接拒绝并报
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。
- 装在沙箱/无人值守环境时，`node_modules` 被掏空后重装依赖本地 store：实测热缓存
  `Done in 2.5s`、`reused 370 / downloaded 4`，内容寻址仓库在 `E:\.pnpm-store\v11`。
  **所以"重装很慢"通常不成立——慢的是缓存失效，不是 install 本身。**
- 判断是"在下载"还是"挂了"：看 `.pnpm` 目录数是否变化、store `.tmp` 是否有产物。
  两者都不动而 CPU 在涨 = 挂死，别干等。

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
- 每次 `dist` 都会重跑 `prepare-runtime` 重新装配随包运行时（走 `main()`，会联网重装官方运行时），
  这一条确实是慢的；只想快速出免安装版用 `-Target pack-local`。
  **但 "慢是正常的" 不能一律套用**：热缓存的 `dist-local` 全流程只需约 30s（`build:all` 5.6s +
  `stage-plugin` 11s + `electron-builder` 17s）。若 `dist-local` 也慢到几分钟，那不是正常现象，
  按上文「构建耗时」一节排查冷缓存 / `release` 累积 / 冷 `node_modules`。

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
- `build:flat` = 扁平化两个「扁平发布单元」（bridge 16 个 + extract 3 个）到
  `dist/bridge-flat/`、`dist/extract-flat/`；`build:all` 已包含这一步

> ⚠️ **在桥接单元里增删文件，必须同步改三份清单**，漏一处会让构建硬失败：
> 1. `scripts/stage-flat-units.ts` 的 `BRIDGE_LAYERS`（决定扁平化谁）
> 2. `src/bridge/desktop-host.ts` 的 `DESKTOP_BRIDGE_FILES`（决定拷进安装包谁）
> 3. `package.json` 的 `build.extraResources`（electron-builder **逐条**发布，非通配符）
>
> `stage-flat-units` 的守卫会故意在构建期抛错，而不是让坏 import 留到运行期。
> `test/prepare-runtime.test.ts` 有一条断言强制 `extraResources` 与
> `DESKTOP_BRIDGE_FILES` 全等——**别改那条断言**，它是防漂移的护栏。
> 上面括号里的数字会随之变化，改动时一并更新。
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

## 随包实验性 browser use：落点和六条硬限制

0.8.2 起随包 `@deepseek-ai/dsh-browser-use`（独占命名的 `browserUse` 槽位）与
`@deepseek-ai/dsh-experimental-browser-use-playwright-mcp`（经固定版本 `@playwright/mcp`
提供 Chromium 工具）；0.8.3 修掉其中两条导致的首启崩溃。改这块前先读完下面六条，
全部是实测踩出来的、光看代码看不出来。

- **落点是 `officialRuntimeDependencies()`（`OFFICIAL_BROWSER_USE_PACKAGES`），不是
  `BUNDLED_PLUGINS`。** 两个包都是 `@deepseek-ai/dsh-*` 官方作用域，而
  `reconcileProfileBundles` 对官方作用域名直接 `continue` ⟹ 它们永远进不了 profile 的
  `dsh.profile.bundles`。"没声明又在磁盘上"正是启动插件对账的清除条件：**把包装进 profile，
  应用一启动就没了**（实测：启动后被 `pnpm remove` 掉，`package.json`/`pnpm-lock.yaml`
  回到原样；而应用运行期间动它反而没事）。运行时目录不在那条路径上。
  推论：新增任何官方作用域的随包能力都适用这条，不限于 browser use。
- **随包 ≠ 启用。** 上游 provider 的设计是"仅在显式挂载后启用"。挂载由
  `src/bridge/browser-use-overlay.ts` 负责：每次启动在 `<userData>/browser-use/` 下物化
  `browser-use.patch.yml`，作为第三个 `--patch` 与桌面桥、设置插件的 overlay 一起传入
  （`main.ts` 两处启动路径都要加）。这样不需要动任何 profile 自己的 `cordis.patch.yml`；
  反过来说，**用户手写过的挂载行必须清掉**，否则同一个独占槽位会被注册两次。
  `DSH_DISABLE_BROWSER_USE=1` 跳过挂载；两个包的入口解析不到时也不挂载（`browserUseRuntimeIsAvailable`）。
- **挂载必须写入口文件的绝对 `file:` URL，不能写裸包名。** 别指望"运行时目录里的包能被裸包名
  解析到"——这个推断是**错的**，代价是一个坏版本：patch 的 `include` 以 profile 目录为解析基准，
  裸包名解析不到只躺在运行时里的包，DSH 子进程直接 `ERR_MODULE_NOT_FOUND` 退出码 1
  （0.8.2 实测）。桌面桥与设置插件的 overlay 一直用 `file:` URL，就是这个原因。入口在
  `runtime/node_modules` 与 `runtime/node_modules/@deepseek-ai/dsh/node_modules` 两处找，
  npm 会把版本冲突的包嵌进后者。
- **overlay 这类"启动期顺手写个文件"的代码，必须自己建目录、且不能把异常抛给启动路径。**
  0.8.2 的另一半故障就是 `writeFileSync` 到一个不存在的 `<userData>/browser-use/`，首启必抛
  `ENOENT` 并让整条启动路径崩掉。可选能力出问题时正确行为是**退化成不挂载**（`mkdirSync` +
  `try/catch → return undefined`），不是把应用带停。
- **`PLAYWRIGHT_BROWSERS_PATH` 是无效的。** provider 构造子进程 env 时只保留
  `PLAYWRIGHT_MCP_*` 这些键且**全部置空**，所以任何"注入环境变量让 playwright 找随包浏览器"
  的想法都不成立，唯一通道是配置项 `executablePath`（→ `--executable-path`）。启动器按
  Chrome → Edge 探测系统浏览器并写入绝对路径；探不到就不写该字段，退回 playwright 自己的
  每用户缓存发现。曾实测评估随包浏览器本体：`chromium_headless_shell` 271 MB、
  完整 `chromium` 433 MB（均未压缩），据此放弃。launch 模式恒定带 `--isolated`。
- **升这批包的版本要跟家族走，且别用 `latest`。** 官方 registry 上这两个包的
  `alpha` dist-tag 才等于 `OFFICIAL_DSH_VERSION`（0.8.2 时是 `0.1.6-alpha.2`），
  `latest` 落后一档。改依赖表后 `officialRuntimeIsCurrent()` 会因缺包判为不新鲜，
  所以**必须走一次完整 `prepare-runtime`（经 `main()`）再出包**，见「升级随包 DSH 运行时」。

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

当前基线是 **551 项 / 545 通过 / 4 失败 / 2 跳过**（4 条失败全部为上述 `.github` 缺口；2 条跳过里有一条
是「从符号链接的 pnpm 垫片定位随包 pnpm 包装目录」——Windows 无符号链接权限时跳过，Linux 上实跑通过。
0.8.3 实测）。
这个数字会随版本变化——**判断是否回归要看"失败的 4 条是不是都是 `.github` 那 4 条"，
而不是看总数**。

### 从 Git Bash 跑测试会多出两条假失败（tar 的锅）

`runtime-archive.test.ts` 的「目录可以打成 tar.gz 再解回原结构」和 `prepare-runtime.test.ts`
的「产物内的清单与 bundled-plugins 声明的身份/版本一致」会报
`tar (child): Cannot connect to E: resolve failed` / `unexpected end of file`——**Git Bash 的
MSYS GNU tar 不认 `E:\...` 这种盘符路径**，把它当成 `host:path` 去解析了。跟被测代码无关。

修法是把系统目录摆到 PATH 前面，让 `tar` 命中 Windows 自带的 bsdtar：

```bash
export PATH="/c/Windows/System32:/c/Windows:$PATH"   # 之后别再用 sort/head 等 coreutils 原名，
                                                     # 会被 Windows 版抢走（sort -u 直接报错）
"/c/Program Files/PowerShell/7/pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1 -Target test
```

另一类入口相关的假失败：`build.ps1` 会导出 `DSH_BUILD_REGISTRY`（镜像源），而
`buildSeedPluginArgs` / `officialRuntimeNpmInstallArgs` 的 registry 正是从它读的——断言默认官方源
的两条用例在 0.8.2 之前经 `build.ps1 -Target test` 必红。现已在这两条用例里显式清掉该变量，
**测试结果不该取决于从哪个入口跑**，以后写这类断言也照这个办法钉住 env。

> 注意 `dsh-process.test.ts` 的「重复关闭同一 DSH 子进程是安全的」在整包并发跑时**偶发**超时
> （单独跑 3/3 通过）。看到它失败先单独复跑一次再判断，不要当成回归。
