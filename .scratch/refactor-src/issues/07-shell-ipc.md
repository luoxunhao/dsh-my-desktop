# 07 — 拆 installShellIpc（22 个 handler，跨 6 个功能域）

**What to build:** 顶栏 IPC 注册从单个巨型函数拆分为按功能域组织的部分，让每个域的处理逻辑
与它所属的模块在一起。

实测规模：该函数注册 22 个 IPC 处理器（12 个 `handle` + 6 组 `on`/`on` 配对）外加 12 次
`removeHandler`，并且单函数扇出 **7 个功能簇的 21 个函数**——是全文件最大的扇出点。它的处理器
分属 6 个不同的功能域（窗口/导航、设置、更新、profile、终端、诊断等）。

**允许拆不干净。** 若拆到一半发现成本超过收益，允许停在"保留在主入口但内部按功能域分组注释"
的状态，**不要为了完成度硬拆**。届时如实报告停在哪里、为什么。

**Blocked by:** 06 — 抽 notifications 与 updater

**Status:** done — 人工验证通过（顶栏各按钮均可用）

- [x] 按功能域梳理 22 个处理器的归属，分为 **6 组**（见下）
- [x] 抽出 `src/desktop/shell-ipc-registrar.ts`，主入口只保留委派
- [x] `removeHandler` / `removeAllListeners` 清理逻辑原样保留在各自分组内
- [x] 依赖图检查：新模块不 import 任何服务模块（全部走 `ShellIpcDeps` 注入）
- [x] `check:all` 通过、全量测试 **333 / 327 / 5**（与基线一致）
- [x] `dist-local` 出包成功
- [x] **实测启动验证**（见下）
- [x] **人工启动应用确认**：顶栏每个按钮都可用（重启、终端、开发者工具、设置、快捷键、关于）

## 执行结果

### 六组划分

| 分组函数 | 通道 | 说明 |
|---|---|---|
| `installShellActionIpc` | getBootstrap / action / tool / popupTool / popupMenu | 顶栏动作与 bootstrap |
| `installNotificationPreferenceIpc` | get/updateNotificationPreferences | 设置页的通知偏好 |
| `installUpdateIpc` | get/updateUpdatePreferences、getDesktopUpdateState、desktopUpdateAction | 设置页的更新偏好与动作 |
| `installWindowControlIpc` | closeDesktopSettings | 渲染进程无法关自己的窗口 |
| `installDshReportIpc` | dshState / dshBoot / dshLocale / dshTheme / dshSettingsVisibility | DSH 渲染进程上报（`on`，非 `handle`） |
| `installNotificationBridgeIpc` | dshNotification | 通知桥事件 |

`installShellIpc` 本身退化为 6 行——**只是组的清单**，读者一眼能看到有哪些域。

### 未拆到「各域处理逻辑与所属模块同处」

ticket 希望「各域处理逻辑与它所属的模块在一起」（例如更新相关 handler 移入
`update-service.ts`）。**实际没有这么做**，原因是那样会让服务模块反向依赖 `ipcMain`
与策略模块，把 Electron IPC 的关注点渗进纯业务服务里——而 ticket 06 刚把这三个服务
做成不依赖 IPC 的形态。

折中方案：**注册集中在一处，但按域分组**。同域 handler 相邻，改一个域只需看一段；
服务模块保持纯净。这是有意的取舍，不是没做完。

### 实施中自查出的两个错误

1. **`dshBoot` 我一度接到 `handleBridgeNotification`** —— 实际应为
   `handleRendererBootReport`。读原实现时发现，已修正。
2. **`shell-actions.js` 的导出名我写成了不存在的 `ShellActionIdAlias`**，
   且误从 `shell-contract.js` 导入 `ShellActionId`（那里没有）。tsc 抓出。

### 实测启动验证（本 ticket 动了 IPC 注册，必须实跑）

| 检查项 | 结果 |
|---|---|
| 进程存活 | ✅ |
| 窗口 | ✅ 标题 `DSH My Desktop` |
| stderr | ✅ 空 |
| `startup-error.log` | ✅ 不存在 |
| DSH 子进程 | ✅ PID 8516，`127.0.0.1:9292` 监听 |
| 两个 `--patch` overlay | ✅ 命令行可见（desktop-bridge + settings-plugin） |
| DSH 首页 | ✅ HTTP 401（token 门禁，正常） |
| 桌面设置插件 API | ✅ HTTP 200 |

主入口 1757 → **1673 行**。


**备注**：本 ticket 的验收重点是"顶栏功能全部可用"，而不是"必须拆成 N 个文件"。
