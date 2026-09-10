# 13 — 抽出恢复流程（最难的一组）

**What to build:** 恢复模式的启动失败处理、恢复页状态、恢复 IPC 独立成模块。

实测范围：`showRecoveryWindow`、`reportStartupFailure`、`presentDshLoadFailure`、
`startupRecoveryCandidates`、`maybeLeaveRecoveryMode`、`clearRecoverySessionHints`、
`returnToWorkbenchFromRecovery`、`installRecoveryIpc`、`recoveryPageStatus`、
`requireRecoveryProfile`、`restartDshInRecoveryMode`，以及启动诊断的四个 wrapper ——
共 **16 个函数、约 260 行**。

**为什么放最后、且为什么难**：实测发现恢复流程与编排层**双向依赖**：

| 恢复侧函数 | 被谁调用（编排侧） |
|---|---|
| `maybeLeaveRecoveryMode` | `handleRendererBootReport`、`openWorkbenchOrRecovery` |
| `presentDshLoadFailure` | `handleRendererBootReport` |
| `reportStartupFailure` | `handleUnexpectedMainError`、`recycleDshForPluginUpdate`、`startApplication` |
| `showRecoveryWindow` | `openWorkbenchOrRecovery` |

即编排调用 recovery，recovery 也回调编排。**直接 import 会成环**，必须注入依赖
（与 ticket 06 处理 tray↔updater 环的方式一致）。

**Blocked by:** 07 — 拆 installShellIpc（`installRecoveryIpc` 与 `installShellIpc` 结构相似，
先做完 07 可复用其拆分经验）

**Status:** ready-for-agent

- [ ] 抽出恢复模块，承载恢复页状态投影、启动失败呈现、恢复 IPC、恢复模式重启
- [ ] **用依赖注入打破双向依赖**：编排侧需要的能力（`handleRendererBootReport`、
      `openWorkbenchOrRecovery` 等）作为回调注入，不反向 import
- [ ] 诊断 wrapper（`beginDshStartupDiagnostic` / `advanceDshStartupDiagnostic` /
      `startRendererHealthTimer` / `stopRendererHealthTimer`）一并归入或明确其归属
- [ ] `check:all` 通过、全量测试不新增失败
- [ ] **`recovery-scenarios.test.ts` 的 19 条用例全部通过**——该文件用 vm 提取真实函数执行
      并断言精确事件序列，是本 ticket 最强的行为契约
- [ ] `dist-local` 出包成功
- [ ] **人工启动确认**：正常启动不受影响；顶栏「重启到恢复模式」能进入恢复页

**备注**：这是全项目耦合最重的一组（16 函数、4 处反向边）。若拆到一半发现成本超过收益，
**允许停在「保留在 main.ts 但内部按恢复流程分组注释」的状态**，并如实报告停在何处、
为什么——与 ticket 07 的处理方式一致。不要为了完成度硬拆出循环依赖。
