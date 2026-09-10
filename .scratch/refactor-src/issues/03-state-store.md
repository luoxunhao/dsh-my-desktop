# 03 — 引入可变状态 store + 窄接口签名

**What to build:** `main.ts` 里 39 个模块级可变变量收进一个显式的可变状态 store，各模块通过
**窄接口签名**只声明自己实际需要的字段。**函数体不动**，只改状态的访问方式。

这一步让"全部可变状态"第一次有了清单，也让每个模块的依赖变成显式的。它是后续所有拆分的
前提——没有共享载体，模块拆到一半就无法访问共享状态。

**关键设计约束（必须遵守，否则静默失效）：**

这个 store 必须是**可变属性容器**，不能是**快照**。现有代码能工作，纯粹因为模块级 `let` 是
**晚绑定**的：IPC 注册发生在前，窗口创建发生在后，handler 在**事件触发时**才解引用窗口变量。

- 正确：`ctx.windows.mainWindow = x`（可变属性，语义与现状逐位相同）
- 错误：把窗口值作为参数传给 IPC 注册函数 → **永久捕获 `undefined`，所有 handler 静默失效**，
  且类型系统抓不住（`BrowserWindow | undefined` 与 `BrowserWindow` 传值都能通过编译）

**真正起作用的是可变性，不是宽度。** 因此各模块签名只声明自己的子集（结构类型自动兼容）。
实测依据：`terminal` 只需 1 组字段，`profiles-ipc` 2 组，而 `shell-ipc` / `window` 需 9 组（全部）
——后三者接收宽切片，因为它们确实是组合根。

**初始化顺序约束（仅一处）**：偏好加载必须先于 IPC 注册完成，因为 handler 会读这两个值。
故 store 工厂必须是 `async` 并被 `await`。

**不进 store 的绑定**（它们是协作者或常量，不是状态）：
- 窗口导航协调器（类实例，模块内单例）
- shell action id 集合（由常量表派生的只读集合）
- DSH 进程模块（顶层 `await import` 的结果，属进程边界依赖，显式传参）

**Blocked by:** 02 — 建分层目录 + 纯移动

**Status:** done — 见下方「执行结果」

- [x] 定义可变 store 及其分子域：`windows` / `runtime` / `launch` / `update` / `shell` /
      `notifications` / `recovery` / `diagnostics` / `chrome`（`src/desktop/desktop-state.ts`）
- [x] store 在 IPC 注册之前创建；偏好加载先于创建（出厂函数改为**同步**并接收已加载的偏好，
      见下方说明）
- [x] 39 个模块级 `let` 全部搬入 store + `activeNotifications` Map；`main.ts` 仅剩
      `let state: DesktopState` 一处声明
- [ ] **窄接口签名：部分完成**（见下方「未完成项」）
- [x] 三个"非状态"绑定不进入 store（已逐项验证：`windowNavigation` / `shellActionIds` /
      `dshProcessModule` 均仅在 main.ts）
- [x] `check:all` 通过、全量测试 **327 / 321 / 5**（与 01 基线一致，无新增失败）
- [x] `dist-local` 出包成功；插件哈希与基线一致，bridge **14/15 一致**
- [ ] 人工启动应用确认 —— **待用户执行**（agent 无法启动 Electron）

## 执行结果

### 实现方式

`createDesktopState()` 是**同步**工厂，接收调用方已加载的偏好：

```ts
const notificationPreferences = await loadNotificationPreferences(...)
const updatePreferences = await loadUpdatePreferences(...)
state = createDesktopState({ notificationPreferences, updatePreferences,
                             initialColorScheme, NotificationCtor })
installShellIpc()
```

这样保持了「偏好加载 → 建 store → 注册 IPC」的顺序，同时让工厂本身保持简单。
`initialColorScheme` 与 `NotificationCtor` 也是注入的——否则该模块会在 import 时
依赖 Electron，而测试环境无法加载 Electron（`vm` scope 里是 stub）。

### 可变性设计（关键约束的落实）

`DesktopState` 的分组引用是 `readonly`，**但字段本身是可变的普通属性**，无 getter：

```ts
readonly windows: WindowsState        // 分组引用不可换
  mainWindow: BrowserWindow | undefined   // 字段可写 —— 晚绑定所必需
```

已确认无 getter（`get` 计数为 0）。`??=` 仍可用于 `state.windows.mainWindow`，
与重构前语义一致。

### 未完成项：窄接口签名

ticket 要求「各模块签名只声明自己需要的字段」。**目前只完成了 store 侧**——所有状态访问
统一为 `state.<group>.<field>`；但**消费者侧仍是 `main.ts` 单文件内的自由函数**，它们直接
闭包引用模块级 `state`，还没有自己的签名可声明。

窄接口是**模块抽取时**才能落地的：只有当 `openDshTerminal` 被移到独立模块，它才需要一个
接收 1 个字段的 deps 参数。因此这条留到 ticket 04~07 落实，届时按 plan 的实测数据
（terminal 1 组、profiles-ipc 2 组、shell-ipc/window 9 组）逐个收窄。

### 产物哈希

插件 2/2 与基线一致。bridge 15 个文件中 14 个一致，仅 `desktop-host.js` 不同——已确认该差异
来自 **ticket 02**（dev 模式改读 `dist/bridge-flat`），本次 ticket 03 未触碰该文件。

### 过程中修正的问题

机械重写脚本产生了几类错误，均已修复：
1. 简写对象属性 `{ isQuitting }` 被改成 `{ state.runtime.isQuitting }`（非法语法）
2. 局部变量 `state`（`currentShellState()` 的返回值、IPC payload 参数）与 store 同名冲突
3. 二次遍历导致 `state.runtime.state.runtime...` 双重前缀（155 处）
4. 分组名与字段名相同的重复：`state.chrome.chrome.cachedWindowIcon`（2 处）
5. `Notification` 误用 DOM 类型而非 Electron 类型

