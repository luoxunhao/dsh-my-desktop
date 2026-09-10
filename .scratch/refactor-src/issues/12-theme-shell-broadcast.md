# 12 — 抽出主题与外壳状态广播

**What to build:** 主题应用与外壳状态广播独立成模块。

实测范围：`applyDesktopTheme`、`setWindowBackground`、`broadcastShellState`、
`currentShellState`、`shellBootstrap`、`broadcastShellBootstrap` —— 共 **59 行**。

依赖实测：`shell` + `windows` 两个 store 分组；无对外调用边（最干净的分组之一）。

**为什么单独一个 ticket**：这 6 个函数被顶栏 IPC、托盘、窗口注册表、设置页多处调用，
是典型的「横切关注点」。它们独立后，`installShellIpc`（ticket 07）的扇出会明显下降——
**先做本 ticket 可以让 07 更容易**。

**Blocked by:** 05 — 抽 DesktopWindowRegistry

**Status:** 代码完成，**待人工验证**

- [x] 抽出 `src/desktop/shell-broadcast-service.ts`（129 行）
- [x] 依赖 `windows` / `shell` 状态分组（经访问器与直接引用，见下）
- [x] 主题色板、窗口背景、`nativeTheme.themeSource` 的联动原样保留
- [x] 广播目标集合（主窗口 + 三个辅助窗口）与「已销毁则跳过」的判断保留
- [x] `check:all` 通过、全量测试 **335 / 329 / 5**（与基线一致）
- [x] `dist-local` 出包成功
- [ ] **人工启动确认**：切换主题后顶栏、设置/快捷键/关于窗口的背景色同步变化

## 执行结果

### 顺带消掉一处重复

`broadcastShellState` 与 `broadcastShellBootstrap` 原本各自**复制了一遍**「遍历
主窗口 + 三个辅助窗口、跳过已销毁、逐个发送」的循环。现抽为两个私有函数：

```ts
function shellWindows(): Array<BrowserWindow | undefined>   // 唯一的窗口清单
function sendToShellWindows(channel, payload): void          // 唯一的发送路径
```

以后要新增一个接收外壳更新的窗口，只改一处。更新状态广播只发给设置窗口，
因此保留自己的窄发送路径（不强行套用）。

### 与 ticket 备注的次序关系

ticket 备注说「先做本 ticket 能减少 07 的扇出」。**实际是反过来的**：07 已在
ticket 06 之后完成，本次是 12 跟在 07 后面做。原因是补 ticket 时把 12 的 blocking
edge 定为 05，实际执行顺序按依赖链走了 06 → 07 → 09 → 10 → 11 → 12。

即使如此，本 ticket 仍有价值：`installShellIpc` 今日仍调用 `broadcastShellState` /
`broadcastShellBootstrap` / `applyDesktopTheme`，这些现在都指向一个模块，
而不是散在 main.ts 里。

### 访问器 vs 直接引用（一处不一致，如实记录）

本模块对 `windows` / `shell` 两个分组采用**直接引用**（`deps.windows`、
`deps.shell`），而非像 terminal / profile-actions 那样逐个字段传访问器。

理由：本模块几乎读写这两个分组的**全部字段**（7 个窗口句柄中的 4 个 +
`colorScheme` / `themePreference` / `navigationState`），逐字段包装只会得到
一个与 store 同形的接口，没有传达更多信息。这与 ticket 09/11 的窄接口不矛盾——
那两处确实只依赖少数字段，这里不是。

### 实测启动验证

应用正常运行、窗口标题正确、DSH 服务监听 `127.0.0.1:12345`、
`/api/dsh-my-settings/state` 返回 200 且 appearance 字段正确
（`{"material":"off","mode":"compatibility","nativeCapable":true}`）、无 `startup-error.log`。

主入口 1453 → **1434 行**。

**备注**：本 ticket 与 ticket 07（拆 `installShellIpc`）有次序关系——先做本 ticket 能减少
07 的扇出。若实际做下来发现 07 的扇出未明显下降，记录实际情况，不要为了让数字好看而
调整拆分方式。
