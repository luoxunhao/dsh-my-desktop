# src/ 重构方案（已定稿）

> 经 `grill-with-docs` 逐项盘问后定稿。所有决策已由用户确认，见 §8 决策记录。
> 目标：让 `src/` 的目录结构反映**职责边界**，并消除 `main.ts` 巨石。

## 1. 现状（实测数据）

`src/` **45 个文件、6911 行、零子目录**全平铺。

**`main.ts` 是巨石**：2151 行、**111 个顶层函数**、**39 个模块级 `let`**（第 65–104 行），
另有 4 个易被遗漏的模块级可变绑定：

| 绑定 | 行 | 说明 |
|---|---|---|
| `windowNavigation` | 89 | 类实例，被 `navigate()` 修改，**不能进上下文**（只读语义） |
| `activeNotifications` | 92 | `Map`，只 mutate 从不重新赋值 |
| `shellActionIds` | 105 | 由 `SHELL_ACTIONS` 派生的**只读常量**，应留在 shell-ipc 模块内 |
| `dshProcessModule` | 60–63 | 顶层 `await import`，属**进程边界依赖**，不该进上下文 |

## 2. 硬约束（决定了方案形态）

### 2.1 循环依赖是必然的，不是风险

实测各功能簇**两两双向依赖**：

- `setDesktopUpdateStatus`（1025）→ `refreshTrayMenu`（1028），而 `refreshTrayMenu`
  经 `buildDesktopTrayItems(status)` 读回 `updateStatus` —— **tray ↔ updater 成环**
- `installShellIpc`（1158）单函数扇出 **7 个簇的 21 个函数**
- `runMainTask`（647）被 **6 个簇**调用（通用错误汇聚点）
- `mainWindow` **22 个读者、横跨 8 个簇**

**结论**：直接 `import` 必定产生 ES 模块循环。必须依赖注入。

### 2.2 晚绑定（最关键，最容易踩）

`installShellIpc()` 在 **182 行**注册，`installRecoveryIpc()` 在 **183 行**，
而首个窗口 `showStartupWindow` 在 **188 行**才创建。

现有代码能工作，**纯粹因为模块级 `let` 是晚绑定的**——handler 在**事件触发时**才解引用
（如 `shellRendererKind` 每次 IPC 都重新读 `mainWindow?.webContents`）。

因此：

- ✅ `ctx.windows.mainWindow = x`（可变属性）—— 语义与现状**逐位相同**
- ❌ `installShellIpc(mainWindow, dshView)`（传值）—— **永久捕获 `undefined`，
  所有顶栏 handler 静默失效**，且类型系统抓不住

**真正的关键是「可变性」，不是「宽度」。** 宽 `AppContext` 在这条约束上一分钱不多买。

### 2.3 初始化顺序（仅一处，2 行窗口）

第 **180–181 行**加载 `notificationPreferences` / `updatePreferences`，
第 **182 行** `installShellIpc()` 的 handler 会读这两个值。
**偏好加载必须先于 IPC 注册完成**——store 工厂若折叠偏好加载则必须是 `async` 且被 `await`。

### 2.4 模块依赖宽度差异极大

| 模块 | 需要字段组 | 备注 |
|---|---|---|
| `shell-ipc` / `window` | **9 / 9** | 真实的组合根 |
| `recovery` | 8 / 9 | |
| `updater` | 5 / 9 | |
| `notifications` | 4 / 9 | |
| `dialogs` / `theme` | 2–3 / 9 | |
| `profiles-ipc` | 2 / 9 | |
| **`terminal`** | **1 / 9** | 157 行代码只碰 `lastSeedOptions` |

宽接口会强迫 `terminal` 依赖窗口、更新、恢复状态——**恰好摧毁抽取的主要收益**。

## 3. 目标结构

```
src/
  main.ts                    # 只留：进程入口 + 启动编排（目标 <300 行）
  app/                       # 进程级身份与生命周期
    identity.ts              # app-identity.ts
    icon.ts                  # app-icon.ts + window-icon.ts
    lifecycle.ts             # app-lifecycle.ts
  infra/                     # 无业务语义的工具
    atomic-file.ts  process-control.ts  readiness.ts
    runtime-archive.ts  escape-routing.ts  navigation.ts
  runtime/                   # DSH 运行时装配
    bundled-plugins.ts  plugin-toolchain.ts  runtime.ts
    runtime-prebuilt.ts  extract-runtime.ts  dsh-bootstrap.mts
  profiles/                  # profile 领域
    registry.ts              # profiles.ts
    seed.ts                  # plugin-seed.ts
    updates.ts  repair.ts  health-checkpoint.ts  watch.ts
  bridge/                    # 注入 DSH 子进程的宿主桥
    host.ts  entry.mts  migration.ts  client-source.ts
    process.ts               # dsh-process.ts
    settings-plugin.ts
  desktop/                   # Electron 主进程 UI
    context.ts               # 可变 store + 窄接口定义
    launch-service.ts        # 【最高杠杆】消三处重复
    window-registry.ts       # 窗口句柄与创建
    window.ts  shell-ipc.ts  tray.ts  terminal.ts
    notifications.ts  updater.ts  theme.ts  dialogs.ts  profiles-ipc.ts
  recovery/
    mode.ts  diagnostics.ts  ipc.ts  startup-diagnostics.ts
  # preload 三个 .cts 保持扁平（见 §4 Q4）
```

**依赖方向**：跨层只能向下（desktop → bridge/profiles/runtime → infra），反向边即设计错误。

## 4. 已确认的决策

| # | 决策 | 结论 |
|---|---|---|
| Q1+Q8 | 完成标准 | **完整方案**：目录 + 拆巨石 + 全部 39 个状态收敛（Q1 修正为 c） |
| Q2 | 目录维度 | **按层** |
| Q3 | `main.ts` 位置 | **留在 `src/main.ts`**（不改 `package.json` 的 `main`） |
| Q4 | preload | **保持扁平不动**（改 `resolvePreload()` 风险高，且无法自动验证） |
| Q5 | 文档位置 | **根目录 `adr/` + `CONTEXT.md`**（`docs/` 被 gitignore，不能放那） |
| Q6 | 打破循环 | **完整注入** |
| Q7 | 拆分顺序 | **按耦合收益**：LaunchService → WindowRegistry → notifications/updater → shellIpc |
| Q12 | 上下文形状 | **单一可变 store + 窄接口签名**（结构类型自动兼容） |
| Q15 | 防反模式 | **加静态检查/单测守住** |
| Q9 | `main.ts` 残留 | 只留入口 + 编排；`installShellIpc` 若拆不干净则保留并分组注释 |
| Q10 | 验证 | **分阶段**：每阶段出包后用户手动启动验证再继续 |
| Q13 | 版本 | **发 0.1.4** |
| Q14 | 文档 | `CONTEXT.md` + 1~2 条 ADR |

## 5. 上下文设计

```ts
// desktop/context.ts —— 一个可变 store，创建于第 182 行之前
interface DesktopState {
  windows: { mainWindow; dshView; recoveryView; shortcutsWindow; aboutWindow; settingsWindow }
  runtime: { server; isQuitting; isRecycling; runtimeExtractionAbortController; runtimeExtractionTask }
  launch:  { lastStartOptions; lastSeedOptions; profileWatcher;
             profileActivationRecyclePending; profileActivationRecycleTask;
             profileActivationRecycleGeneration; isReportingUnexpectedError }
  update:  { status; preferences; lastUpdateCheckAt; startupUpdateTimer }
  shell:   { navigationState; allowedOrigin; settingsDialogVisible;
             locale; colorScheme; themePreference }
  notifications: { preferences; active; unreadCompletionCount }
  recovery: { profileDir; failureMessage; failurePlugin; failurePlugins; handlingRendererBootFailure }
  diagnostics: { stage; rendererHealthTimer }
  chrome:  { cachedWindowIcon }
}

/** 必须是 async：偏好加载（180-181）要先于 IPC 注册（182）完成。 */
declare function createDesktopState(): Promise<DesktopState>
```

**各模块签名只声明自己需要的子集**（`Pick<DesktopState, ...>` 或手写窄接口）：

```ts
interface TerminalDeps    { readonly launch: Pick<LaunchContext, 'lastSeedOptions'> }
interface ThemeDeps       { readonly shell: ShellContext; readonly windows: WindowsContext }
interface RecoveryDeps    { readonly recovery: RecoveryContext; readonly windows: WindowsContext;
                            readonly runtime: RuntimeContext; readonly launch: LaunchContext;
                            readonly diagnostics: DiagnosticsContext }
```

`window` / `shell-ipc` / `recovery` 接收宽切片——因为它们**确实**是组合根，这是事实而非妥协。

**不进上下文的**：`windowNavigation`（类实例，模块内单例）、`activeNotifications`
（可留在 notifications 模块内，updater 通过显式函数调用而非直接读 Map）、
`shellActionIds`（派生常量）、`dshProcessModule`（进程边界依赖，显式传参）。

## 6. 执行顺序

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P0** | 记录基线：`lib/`、`app.asar` 关键文件哈希 | — |
| **P1** | 建目录 + `git mv` 纯移动，**代码一行不改** | `check:all` + 测试 + 出包，产物哈希应**不变** |
| **P2** | 引入 `DesktopState` store + 窄接口（状态搬家，函数不动） | 同上 |
| **P3** | 抽 `DshLaunchService`——消 `startWithProfileSelfRepair` 三处重复（302/766/1076） | 手动启动验证 |
| **P4** | 抽 `DesktopWindowRegistry`——解锁 `mainWindow`（22 读者） | 手动启动验证 |
| **P5** | 抽 notifications + updater（共享 `activeNotifications`，含 tray 环） | 手动启动验证 |
| **P6** | 拆 `installShellIpc`（22 个 handler，跨 6 域）——**最后做，拆不干净就停** | 手动启动验证 |
| **P7** | `CONTEXT.md` + ADR + 更新 `AGENTS.md` | — |

**P3 是最高杠杆**：`startApplication`、`recycleDshForPluginUpdate`、`restartDshInRecoveryMode`
三处几乎逐字重复同一段启动逻辑，抽掉它能一次性把 5 个共享变量从三个模块里摘除。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| **传值捕获 `undefined`**（§2.2） | Q15 静态检查：断言 `installShellIpc`/`installRecoveryIpc` 调用处未传窗口值 |
| 偏好加载与 IPC 注册顺序（§2.3） | store 工厂为 `async`，`await` 于 182 行前；测试断言顺序 |
| ES 模块循环依赖（§2.1） | 依赖注入；拆分后用依赖图脚本复核无反向边 |
| `extraResources` 扁平文件名清单（15 个） | P1 同步改 `package.json` 的 `from`/`filter`——**漏了构建仍成功、运行时才缺文件** |
| 41 个测试的 `../src/<name>.js` 路径 | 逐个改；TS 编译期报断链，不会静默 |
| 窗口层无法自动验证 | Q10 分阶段：每阶段出包后**用户手动启动确认**再继续 |
| 拆分引入运行时时序问题 | 每阶段比对产物哈希 + 全量测试 + 人工启动 |

## 8. 验收标准

- `src/` 无 45 文件平铺；每文件可从目录判断所属层。
- `main.ts` < 300 行，只做编排。
- 39 个模块级 `let` 全部收进 `DesktopState`；跨层依赖单向（脚本复核无反向边）。
- `check:all`、`test`（326/320 基线不退化）、`dist-local` 出包成功。
- **产物哈希与 P0 基线一致**（纯重构不应改变产物）。
- 新增静态检查测试通过。
- `CONTEXT.md` + ADR 落地；`AGENTS.md` 关键文件章节更新。
- 版本发 0.1.4。
