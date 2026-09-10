# 05 — 抽 DesktopWindowRegistry

**What to build:** 窗口句柄与窗口创建逻辑独立成一个模块，为"主窗口"这个全文件最宽的读取点
提供明确的归属。

实测依据：主窗口句柄有 **22 个读者、横跨 8 个功能簇**——没有任何功能切法能把它隔离在单一模块
内。因此它必须首先获得一个明确的缝（seam），其他模块才能安全地继续拆分。

涉及的窗口：主窗口、DSH 内容视图、恢复视图，以及三个辅助窗口（设置 / 快捷键 / 关于）。

**这是最需要人工验证的 ticket**：窗口创建时序一旦出错，表现是白屏或窗口不出现。

**Blocked by:** 04 — 抽 DshLaunchService

**Status:** 代码完成，**待人工启动验证**

- [x] 抽出 `src/desktop/window-registry.ts`，集中持有全部窗口/视图句柄与创建、布局、
      显示切换逻辑
- [x] 窗口句柄仍通过 store 的可变属性暴露；注册表只提供访问器，**不按值外传**
      （晚绑定护栏测试已通过：`installShellIpc()` / `installRecoveryIpc()` 仍是零参数）
- [x] 恢复视图与主视图的显示切换（`showDshContentView` / `showRecoveryContentView`）、
      布局（`layoutDshView` / `layoutRecoveryView`）归入该模块
- [x] 窗口关闭事件处理（`close` / `closed`）归入该模块
- [x] `check:all` 通过、全量测试 **330 / 324 / 5**（与基线一致）
- [x] `dist-local` 出包成功；插件哈希 2/2 一致，bridge 14/15（差异仍来自 ticket 02）
- [ ] **人工启动应用确认**：启动窗口出现、主窗口正常加载 DSH 界面、尺寸与布局正确
- [ ] **人工确认**：恢复视图与主视图切换正常（本 ticket 最可能出问题的地方）

## 执行结果

### 抽取内容

`createWindow()` 原本一个函数里塞了 **7 类不相关关注点**（主题配色、preload 解析、
导航守卫、快捷键安装、持久化窗口状态、shell 状态广播、恢复状态清理）——即评审指出的
Divergent Change。现在它接收一个显式的 `WindowRegistryDeps`，把 7 类依赖变成可读的签名。

搬入 registry 的：`createWindow`、`requireDshView`、`requireRecoveryView`、
`showDshContentView`、`showRecoveryContentView`、`layoutDshView`、`layoutRecoveryView`、
`showMainWindow`，以及新增的 `ensureMainWindow`。

`main.ts` 保留同名薄包装，一次性把注册表绑定到真实协作者（在 `startApplication` 中、
store 之后、IPC 注册之前初始化）。

### 晚绑定契约（本 ticket 的核心风险）

三处调用点原本是 `state.windows.mainWindow ??= createWindow()`。`??=` 现在移入
`ensureMainWindow()`，使这个契约只存在于一处；调用点简化为 `createWindow()`。

`showRecoveryWindow` 原先依赖 `??=` 的返回值做类型收窄（`const window = ... ??= ...`），
改用 `const window = createWindow()` 后仍保持收窄。

**护栏测试通过**：`installShellIpc()` / `installRecoveryIpc()` 仍是零参数调用，
没有把窗口值按值传进 IPC 注册。

### 一处修正（差点引入的行为变更）

我最初把窗口 `close` 处理写成 `!state.runtime.isQuitting`，但原实现调用的是
`app-lifecycle.ts` 的 `shouldHideInsteadOfClose(isQuitting, platform)`，其中还有
**`platform !== 'linux'`** 条件。手写会丢掉 Linux 分支的行为。已改为 import 真实函数。

### 测试侧

4 处源码断言因抽取而过期，改为读取 `window-registry.ts`（断言意图不变，只是换了文件）：
`new WebContentsView`、`contentView.addChildView`、`title: DESKTOP_APP_NAME`、
`recovery-preload.cjs`、`dshView?.setVisible(false)`、`will-navigate`/`will-redirect`。

主入口 2122 → **2167 行**（略增：新增了注册表初始化与 7 个薄包装，但窗口实现已移出）。

