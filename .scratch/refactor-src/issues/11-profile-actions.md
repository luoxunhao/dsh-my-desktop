# 11 — 抽出 profile IPC 与桌面动作

**What to build:** profile 的建/删/切与其余「桌面动作」（开发者工具、重启）独立成模块。

实测范围：`launcherProfileRoots`、`currentProfilesSnapshot`、`createWebProfile`、
`switchWebProfile`、`deleteWebProfile`、`desktopProfileViews`、`restartDesktop`、
`toggleDeveloperTools`、`restartIntoRecoveryFromShell` —— 约 **69 行**。

依赖实测：`launch` + `runtime` 两个 store 分组，对外调用 `readActiveProfile` /
`writeActiveProfile`（均来自 `src/profiles/`）。

**Blocked by:** 09 — 抽出终端服务（同为「由 IPC 触发的宿主动作」类，先做完终端可复用
其窄接口写法）

**Status:** ready-for-agent

- [ ] 抽出 profile/桌面动作模块
- [ ] 依赖窄接口（`launch.lastSeedOptions`、`runtime.server` 等实际需要的字段），
      不使用整个 store
- [ ] profile 名合法性校验、当前 profile 不可删、删除入回收站的语义**原样保留**
- [ ] 切换 profile 后持久化 + 重启整代的行为保留
- [ ] `check:all` 通过、全量测试不新增失败
- [ ] `dist-local` 出包成功
- [ ] **人工启动确认**：设置页能列出 profile、能新建、能删除（非当前）、能切换并重启

**备注**：profile 的建/删/切有真实副作用（落盘、重启），这是本项目里最容易出事的路径之一
（此前修过「新建/删除需重启才生效」和「同名重建继承删除样式」两个 bug）。抽取时**只搬不改**，
若发现逻辑问题，记录到 ticket 而不是顺手修。
