# Spec: `src/` 分层重构

Status: ready-for-agent

## Problem Statement

`src/` 目前是 **45 个文件、6911 行、零子目录**的全平铺结构，随着功能增长已经难以导航和维护。
最严重的是 `main.ts`：**2151 行、111 个顶层函数、39 个模块级 `let`**，一个文件里混了 9 类互不
相关的职责（启动编排、窗口管理、恢复模式、顶栏 IPC、profile 管理、终端、通知、更新器、托盘、
对话框窗口）。

对维护者的具体影响：

- 想改"通知行为"要先在 2151 行里定位，且必须理解窗口、更新、托盘的耦合才能安全改动。
- 文件名前缀无法表达边界：8 个 `desktop-*` 文件分属完全不同的层——`desktop-host.ts` 是"注入
  DSH 子进程的宿主服务"，`desktop-updater.ts` 是"Electron 主进程的自动更新"，却共享前缀。
- 39 个模块级可变变量被 111 个函数隐式共享，任何改动都可能踩到时序耦合。
- 新人（或 agent）无法从目录结构判断"这段代码属于哪一层、可以依赖谁"。

## Solution

把 `src/` 重构为按**层**划分的目录结构，并把 `main.ts` 拆分为职责单一的模块：

- `main.ts` 退化为「进程入口 + 启动编排」。
  **（修正）** 原文写「目标 < 300 行」，但该数字从未做过行数预算，实测不可达：补完全部 ticket
  后预计仍有约 725 行，且残留是 `startApplication`(172 行) 等**有意义的编排步骤**，不是可清理
  的杂波。已改为「不承载任何具体功能域的实现」，不再以某个数字为验收条件。
  详见 `.scratch/refactor-src/REVIEW-before-06.md`。
- 39 个模块级可变变量收进一个显式的**可变状态 store**，各模块通过**窄接口签名**只声明自己
  实际需要的字段。
- 目录按层组织（`app/` `infra/` `runtime/` `profiles/` `bridge/` `desktop/` `recovery/`），
  跨层依赖单向（只能向下）。

**验收的核心是"外部行为完全不变"**：这是纯结构重构，打包产物应与重构前逐字节一致。

## User Stories

1. 作为维护者，我希望从目录名就能判断一个文件属于哪一层，这样我不用打开文件就能知道它的职责边界。
2. 作为维护者，我希望 `main.ts` 只负责启动编排，这样我改启动流程时不必在 2151 行里翻找。
3. 作为维护者，我希望"通知"相关代码都在 `desktop/notifications.ts`，这样我能在一个文件里看完整个通知功能。
4. 作为维护者，我希望"更新器"相关代码都在 `desktop/updater.ts`，这样我不用在巨石文件里追踪更新状态流转。
5. 作为维护者，我希望"托盘"逻辑独立成模块，这样我改托盘菜单时不会误触窗口生命周期。
6. 作为维护者，我希望"恢复模式"独立成目录，这样我能清楚看到它与正常启动路径的边界。
7. 作为维护者，我希望"profile 管理"的 IPC 处理独立成模块，这样我能专注于 profile 的建/删/切语义。
8. 作为维护者，我希望"终端"逻辑独立，这样我改 `openDshTerminal` 时不必加载窗口与更新状态的心智负担。
9. 作为维护者，我希望 39 个可变变量集中在一个显式 store 中，这样我能看到全部可变状态的清单，而不是靠 grep `^let`。
10. 作为维护者，我希望每个模块的签名只声明它真正依赖的字段，这样 `terminal` 不会平白依赖窗口句柄。
11. 作为维护者，我希望依赖方向是单向的（跨层只能向下），这样我不会意外制造循环依赖。
12. 作为维护者，我希望启动逻辑中三处重复的代码被抽取为一个 service，这样修一个启动 bug 只需要改一处。
13. 作为维护者，我希望重构后打包产物与重构前逐字节一致，这样我有信心"行为没变"。
14. 作为维护者，我希望全量测试基线不退化（326 项 / 320 通过），这样重构没有引入回归。
15. 作为维护者，我希望有一条自动检查守住"不要把窗口值传进 IPC 注册函数"这个反模式，因为这类错误类型系统抓不住、且会静默失效。
16. 作为维护者，我希望重构分阶段进行、每阶段可独立验证，这样出问题时能定位到是哪一步引入的。
17. 作为维护者，我希望每个阶段出包后能由我手动启动确认，因为 agent 无法启动 Electron 验证窗口层。
18. 作为 agent，我希望有 `CONTEXT.md` 记录本项目特有术语（如"晚绑定""可变 store"），这样我不会用错词或发明新词。
19. 作为 agent，我希望有 ADR 记录"为什么用依赖注入而不是事件总线"，这样半年后不会有人试图"修复"这个决定。
20. 作为维护者，我希望 `AGENTS.md` 的关键文件章节更新为新路径，这样 agent 不会按旧路径找文件。
21. 作为维护者，我希望重构作为一个独立版本（0.1.4）发布，这样有明确的回退点。
22. 作为维护者，我希望三个 preload 脚本保持原位不动，这样不会因为改动加载路径导致应用白屏。
23. 作为维护者，我希望 `extraResources` 的文件清单同步更新，这样打包资源不会缺文件。
24. 作为维护者，我希望 41 个测试的 import 路径同步更新，这样测试不会因断链失败。
25. 作为维护者，我希望重构过程中不引入任何行为变化，这样我不需要重新验证已有功能。

## Implementation Decisions

### 目录结构：按层划分

`src/` 重组为以下层，**跨层只能向下依赖**（desktop → bridge/profiles/runtime → infra），反向边即设计错误：

- `app/` —— 进程级身份与生命周期
- `infra/` —— 无业务语义的工具（原子文件写、进程控制、就绪探测、归档、导航）
- `runtime/` —— DSH 运行时装配（bundled plugins、plugin toolchain、运行时解压）
- `profiles/` —— profile 领域（注册表、seed、更新、修复、健康检查点、监听）
- `bridge/` —— 注入 DSH 子进程的宿主桥（host、entry、migration、client-source、process、settings-plugin）
- `desktop/` —— Electron 主进程 UI（窗口、顶栏 IPC、托盘、终端、通知、更新器、主题、对话框、profile IPC）
- `recovery/` —— 恢复模式（mode、diagnostics、ipc、startup-diagnostics）

`main.ts` **保留在 `src/` 根目录**（进程入口位置稳定，且不改 `package.json` 的 `main` 字段）。

三个 preload `.cts` 脚本**保持扁平不动**：`resolvePreload()` 硬编码 `dist/src/<name>.cjs`，
改动它风险高（改错即白屏），而 agent 无法启动 Electron 验证。

### 状态模型：单一可变 store + 窄接口签名

39 个模块级可变变量收进一个显式 store。关键设计约束（来自对 `main.ts` 的实测分析）：

**这个 store 必须是"可变属性容器"，不能是"快照"。** 现有代码能工作，纯粹因为模块级 `let` 是
**晚绑定**的——`installShellIpc()` 在第 182 行注册，而首个窗口在第 188 行才创建，handler 在
**事件触发时**才解引用窗口变量。因此：

- 正确：`ctx.windows.mainWindow = x`（可变属性，语义与现状逐位相同）
- 错误：`installShellIpc(mainWindow, dshView)`（传值 → **永久捕获 `undefined`，所有顶栏
  handler 静默失效**，且类型系统抓不住）

**真正起作用的是可变性，不是宽度。** 宽对象在这条约束上一分钱不多买。因此各模块签名**只声明
自己需要的子集**（`Pick<Store, ...>` 或手写窄接口），结构类型自动兼容：

```ts
interface TerminalDeps { readonly launch: Pick<LaunchContext, 'lastSeedOptions'> }
```

实测依据：`terminal` 只需 1 组字段（157 行代码只碰 `lastSeedOptions`），`profiles-ipc` 2 组，
而 `shell-ipc` / `window` 需 9 组（全部）——后三者接收宽切片，因为它们**确实**是组合根。

**初始化顺序约束（仅一处）**：偏好加载（第 180–181 行）必须先于 IPC 注册（第 182 行）完成，
因为 handler 会读这两个值。故 store 工厂必须是 `async` 并被 `await`。

**不进 store 的绑定**：

- `windowNavigation` —— 类实例，模块内单例（不是状态，是协作者）
- `shellActionIds` —— 由 `SHELL_ACTIONS` 派生的只读常量，属 shell-ipc 模块作用域
- `dshProcessModule` —— 顶层 `await import` 的结果，属**进程边界依赖**，显式传参

### 打破循环依赖

实测各功能簇**两两双向依赖**，直接 `import` 必定产生 ES 模块循环：

- `setDesktopUpdateStatus` → `refreshTrayMenu`，而 `refreshTrayMenu` 经
  `buildDesktopTrayItems(status)` 读回更新状态 —— **tray ↔ updater 成环**
- `installShellIpc` 单函数扇出 7 个簇的 21 个函数
- `runMainTask` 被 6 个簇调用（通用错误汇聚点）
- `mainWindow` 22 个读者、横跨 8 个簇

**决策：用依赖注入**（store 作为显式参数传递），而非事件总线。理由：实际只有少数几条边真成环，
用显式依赖足以打破；完整事件总线对这种规模是过度设计，且会让调用链难以追踪。

### 最高杠杆的抽取：DshLaunchService

`startWithProfileSelfRepair` 那段启动逻辑在 **三处几乎逐字重复**：`startApplication`、
`recycleDshForPluginUpdate`、`restartDshInRecoveryMode`。抽取为一个 launch service 能一次性
把 5 个共享变量从三个模块中摘除，因此**排在拆分顺序最前**。

### 执行顺序

| 阶段 | 内容 |
|---|---|
| P0 | 记录基线：打包资源关键文件哈希 |
| P1 | 建目录 + 纯移动，**代码一行不改** |
| P2 | 引入 store + 窄接口（状态搬家，函数不动） |
| P3 | 抽 `DshLaunchService`（消三处重复） |
| P4 | 抽 `DesktopWindowRegistry`（解锁 `mainWindow`） |
| P5 | 抽 notifications + updater（共享 `activeNotifications`，含 tray 环） |
| P6 | 拆 `installShellIpc`（22 个 handler，跨 6 域）—— 最后做，拆不干净就停 |
| P7 | `CONTEXT.md` + ADR + 更新 `AGENTS.md` |

### 必须同步修改的引用点（实测确认）

1. **`package.json` 的 `build.extraResources` `desktop-bridge` 组**：`from: "dist/src"` +
   15 个**扁平文件名** filter。文件移入子目录后必须同步改——**漏了构建仍成功、运行时才缺文件**。
2. **`resolvePreload()`** 硬编码 `dist/src/<name>.cjs`。若移动 preload 必须同步改（本方案选择不动）。
3. **41 个测试文件的 `../src/<name>.js` import**：全部是单层扁平路径，需逐个改为分层路径。
   TS 编译期会报断链，不会静默。
4. **`scripts/smoke-settings-plugin-boot.mjs`** 有 3 处 `dist/src/...` 引用。

### 文档产出

- `CONTEXT.md`（仓库根）—— 记录本次澄清的术语
- `adr/`（仓库根，**不是 `docs/adr/`**，因为 `.gitignore` 有 `docs/` 规则）—— 1~2 条 ADR，
  至少包含"为何用依赖注入而非事件总线"
- `AGENTS.md` 的关键文件章节更新为新路径

## Testing Decisions

**好测试的标准**：本次重构的验收是"**外部行为不变**"，因此测试应当验证**可观测的外部行为**，
而非内部结构。具体来说：不应该断言"某个函数在某个文件里"，而应该断言"打包产物内容不变"和
"既有行为断言全部继续通过"。

**唯一的例外**是有意为之的结构约束（见下第 3 条）——那是**设计护栏**，不是行为测试。

### 测试缝（seam）

**沿用现有缝，不新增**。重构不引入新功能，因此不需要新缝。验收依赖三个既有缝：

1. **打包产物哈希**（P0 建立的基线）—— 最强证据：纯重构不应改变产物。
   比对 `release/win-unpacked/resources/` 下的关键文件（插件 `lib/index.js`、`lib/client.js`、
   `desktop-bridge/` 内容）。
2. **现有全量测试**（`test/*.test.ts`，53 个文件）—— 基线 **326 项 / 320 通过 / 5 失败**。
   5 项失败是已知缺口（4 项缺 `.github/workflows/desktop-package.yml`，1 项 `profile-repair`），
   重构后必须仍是**同样的 5 项**，不能新增。
3. **新增一条静态检查**（设计护栏）—— 断言 `installShellIpc` / `installRecoveryIpc` 的调用处
   **没有传入窗口值**。理由是这类错误**类型系统抓不住**（`BrowserWindow | undefined` 与
   `BrowserWindow` 在传值场景下都能通过类型检查），且失败方式是**静默的**（handler 永久持有
   `undefined`）。这是本次重构最容易踩、最难查的坑，值得一条专门的护栏。

**Prior art**：仓库里已有"读源码文本做断言"的先例——`test/dsh-view-preload.test.ts` 用
`readFile(new URL('../src/dsh-view-preload.cjs', import.meta.url), 'utf8')` 读取源文件并对内容
断言；`test/prepare-runtime.test.ts` 同样读取 `package.json` 与 workflow 文件做结构断言。
新增的静态检查沿用这个模式。

**额外的人工验证**：agent 无法启动 Electron（无 GUI），因此窗口层的运行时时序问题无法自动
验证。每阶段出包后**由维护者手动启动应用确认**再进入下一阶段。

## Out of Scope

- **三个 preload 脚本（`.cts`）的移动** —— 保持扁平。移动需要同步改 `resolvePreload()`，
  改错即白屏，而 agent 无法自动验证。
- **新增功能或行为变更** —— 本次是纯结构重构，任何行为变化都是 bug。
- **`desktop-bridge` 暴露的 ctx 服务接口变更** —— `desktopProfiles` / `desktopPnpm` /
  `desktopRuntime` 的对外契约不变。
- **插件（`plugins/dsh-my-desktop-settings/`）内部重构** —— 该插件刚完成目录重命名，本次不动。
- **`installShellIpc` 的彻底拆分** —— 若在 P6 发现成本超过收益（22 个 handler 跨 6 个域），
  允许停在"保留在 `main.ts` 但内部按功能分组注释"的状态，不硬拆。
- **`docs/` 下文档的整理** —— `docs/` 被 gitignore，且与本次重构无关。
- **CI 配置（`.github/workflows/`）** —— 补它能让 4 项既有测试转绿，但属于独立任务。

## Further Notes

### 为什么本次重构值得一个独立版本

改动面覆盖整个 `src/`，且包含状态模型变更。虽然目标行为不变，但风险足够高，值得一个明确的
回退点（0.1.4）。

### 关于"完整方案"的取舍

本次采用完整方案（目录 + 拆巨石 + 全部状态收敛），而非分次妥协。这意味着：
- 收益：一次做对，不留半吊子状态。
- 代价：风险从"中等"升到"高"，且窗口层的运行时时序问题**只能靠人工启动发现**。
  分阶段执行 + 每阶段人工确认，是控制这个风险的主要手段。

### 已知的验证盲区

agent 在这个环境**无法启动 Electron**（没有 GUI）。因此以下问题自动验证覆盖不到，只能靠
维护者手动启动发现：窗口创建时序、IPC handler 的晚绑定是否正确、托盘与更新器的交互、
恢复模式的进入/退出。这是本方案把"分阶段人工确认"作为强制环节的原因。

### 一条重要的实测纠正

在方案形成过程中，一度认为 `main.ts` 是 2287 行 / 40 个 `let`。经 `Measure-Object` 复核，
准确数字是 **2151 行 / 39 个 `let`**（另有 4 个易被遗漏的模块级可变绑定：`windowNavigation`、
`activeNotifications`、`shellActionIds`、`dshProcessModule`，见"不进 store 的绑定"）。
