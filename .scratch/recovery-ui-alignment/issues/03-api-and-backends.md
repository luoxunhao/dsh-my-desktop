# 03 — API 层 + checkpoint / profile 后端接线

**What to build:** 恢复页与主进程之间的类型化 API 层，并把**已存在但未暴露**的
checkpoint 与 profile 能力接到恢复页。

**Blocked by:** 01

**Status:** ready-for-agent

## 为什么要这一步

**阶段 3 那套精心实现、经过评审加固的快照能力，目前对用户不可见。**

- `createDesktopProfileCheckpoint` 已具备：3 槽轮转、skip marker、原子替换、
  损坏槽容错、路径映射防静默失效、每文件上限
- 但恢复页只有 8 个 IPC（`activate` / `getStatus` / `keepIsolated` / `getStartupLog` /
  `restore` / `restoreHealthyConfig` / `returnToWorkbench` / `uninstall`），
  **没有任何 checkpoint 入口**

profile 同理：`desktopProfiles` 后端早已存在（ticket 11 抽出的
`profile-actions-service`，设置插件里也已有 UI），恢复页里没有。

## 关键约束

**新增的 IPC 不得依赖运行中的 DSH Host。** 恢复模式的核心价值就是"Host 起不来时
仍能自救"（阶段 5 已实现不启动 Host）。实测现有 8 个恢复 IPC 均无
`state.runtime.server` 依赖——新增的必须保持这个性质。

## 交付物

- [ ] 类型化的 `recovery-api` 包装层（对接 preload 的 `dshRecovery.*`）
- [ ] 扩充 preload + 主进程 handler：
  - [ ] checkpoint：**列表**（3 槽，含空槽 / 损坏槽）、**差异检查**（将改动哪些文件）
  - [ ] profile：**列表**（含 current / selectable）
- [ ] renderer 安全投影：不把绝对路径等敏感信息无差别暴露给页面

## 验收

- [ ] 开发者工具里逐个方法可调通
- [ ] **损坏槽不影响其它槽**这一阶段 3 的性质在投影层仍成立
- [ ] 不启动 Host 的情况下这些 IPC 可用
- [ ] 全量测试基线不变（406 / 400 / 5）

## 不做

- 不重新实现 checkpoint 逻辑（复用阶段 3）
- 不重新实现 profile 系统（复用既有）
- 不做数据目录管理 / 出厂重置 / 配置文件编辑（无后端）
