# 11 — 抽出 profile IPC 与桌面动作

**What to build:** profile 的建/删/切与其余「桌面动作」（开发者工具、重启）独立成模块。

实测范围：`launcherProfileRoots`、`currentProfilesSnapshot`、`createWebProfile`、
`switchWebProfile`、`deleteWebProfile`、`desktopProfileViews`、`restartDesktop`、
`toggleDeveloperTools`、`restartIntoRecoveryFromShell` —— 约 **69 行**。

依赖实测：`launch` + `runtime` 两个 store 分组，对外调用 `readActiveProfile` /
`writeActiveProfile`（均来自 `src/profiles/`）。

**Blocked by:** 09 — 抽出终端服务（同为「由 IPC 触发的宿主动作」类，先做完终端可复用
其窄接口写法）

**Status:** done — 人工验证通过（profile 列出/新建/删除/切换均正常）

- [x] 抽出 `src/desktop/profile-actions-service.ts`（151 行）
- [x] 依赖窄接口：4 个 store 字段经访问器传入，未 import `DesktopState`
- [x] profile 名合法性校验、当前 profile 不可删、删除入回收站的语义**原样保留**
- [x] 切换 profile 后持久化 + 重启整代的行为保留
- [x] `check:all` 通过、全量测试 **335 / 329 / 5**（与基线一致）
- [x] `dist-local` 出包成功
- [x] **人工启动确认**：profile 列出/新建/删除/切换均正常

## 执行结果

### 恢复流程按注入而非 import

`restartIntoRecoveryFromShell` 需要 `restartDshInRecoveryMode`，而后者属 ticket 13
（恢复流程）的范围。直接 import 会让本模块依赖一个**尚未抽出、且已排期要移动**的组。
因此改为注入回调 —— 与 ticket 06/10 处理环的方式一致。

### 窄接口

4 个 store 字段经访问器注入：`launch.lastSeedOptions`、`launch.lastStartOptions`、
`runtime.isQuitting`、`windows.dshView`。全部在调用时读取（晚绑定），未 import store。

### 实测验证（走真实链路）

直接请求运行中应用的桌面设置插件 API，读取 profile 列表 —— 这**完整经过**
`desktopProfileViews` / `currentProfilesSnapshot` 这两个被抽出的函数：

    web     → current=true,  deletable=false, selectable=true
    desktop → current=false, deletable=true,  selectable=true
    三个桥接均 connected

三项语义均正确：当前 profile 标记正确、**当前 profile 不可删**、
另一个 profile 可切换可删除。这比"能启动"更强 —— 它验证的是 ticket 11 的实际行为。

另：DSH 服务监听 `127.0.0.1:11762`、首页 401、无 `startup-error.log`。

### 一次假警报（记录以免误判）

首次启动验证时应用**退出码 0**、stderr 为空、无错误日志。排查发现是上一轮
`pnpm start` 遗留的 **5 个 dev-mode electron 进程**占着单实例锁，导致打包版启动后
立即让位退出。清掉后正常。**不是回归**。

主入口 1572 → **1453 行**。

**备注**：profile 的建/删/切有真实副作用（落盘、重启），这是本项目里最容易出事的路径之一
（此前修过「新建/删除需重启才生效」和「同名重建继承删除样式」两个 bug）。抽取时**只搬不改**，
若发现逻辑问题，记录到 ticket 而不是顺手修。
