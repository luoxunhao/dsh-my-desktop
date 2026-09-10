# 12 — 抽出主题与外壳状态广播

**What to build:** 主题应用与外壳状态广播独立成模块。

实测范围：`applyDesktopTheme`、`setWindowBackground`、`broadcastShellState`、
`currentShellState`、`shellBootstrap`、`broadcastShellBootstrap` —— 共 **59 行**。

依赖实测：`shell` + `windows` 两个 store 分组；无对外调用边（最干净的分组之一）。

**为什么单独一个 ticket**：这 6 个函数被顶栏 IPC、托盘、窗口注册表、设置页多处调用，
是典型的「横切关注点」。它们独立后，`installShellIpc`（ticket 07）的扇出会明显下降——
**先做本 ticket 可以让 07 更容易**。

**Blocked by:** 05 — 抽 DesktopWindowRegistry

**Status:** ready-for-agent

- [ ] 抽出主题/外壳状态模块
- [ ] 依赖 `WindowRegistry`（广播目标是全部外壳窗口）与 `shell` 状态分组
- [ ] 主题色板、窗口背景、`nativeTheme.themeSource` 的联动原样保留
- [ ] 广播目标集合（主窗口 + 三个辅助窗口）与「已销毁则跳过」的判断保留
- [ ] `check:all` 通过、全量测试不新增失败
- [ ] `dist-local` 出包成功
- [ ] **人工启动确认**：切换主题后顶栏、设置/快捷键/关于窗口的背景色同步变化

**备注**：本 ticket 与 ticket 07（拆 `installShellIpc`）有次序关系——先做本 ticket 能减少
07 的扇出。若实际做下来发现 07 的扇出未明显下降，记录实际情况，不要为了让数字好看而
调整拆分方式。
