# 04 — 抽 DshLaunchService（消除三处启动逻辑重复）

**What to build:** 把三处几乎逐字重复的启动逻辑合并为一个 launch service，使"启动 DSH 子进程"
这件事只有一个实现。

实测三处重复点：
- 应用首次启动的编排流程
- 插件更新后的回收重启流程
- 恢复模式下的重启流程

三者共享同一套骨架：带 profile 自修复的启动调用、意外退出与 IPC 消息回调、启动诊断的
开始与推进、以及启动后进入工作台或恢复页的决策。

这是**最高杠杆的抽取**：一次性把 5 个共享变量从三个模块里同时摘除。因此排在所有功能模块
拆分之前。

**这是第一个真正改变代码结构的 ticket**，也是唯一预期可能出现行为差异的地方——三处重复
未必完全等价。

**Blocked by:** 03 — 引入可变状态 store + 窄接口签名

**Status:** done — 见下方「执行结果」

- [x] **逐行核对三处差异** —— 结论：本 ticket 的前提被高估，见下方
- [x] 抽出 `src/desktop/launch-service.ts` 承载真正共享的骨架
- [x] 三处调用点改为使用该 service
- [x] 共享状态内聚：`server` 通过 `setServer` 回调发布；`lastStartOptions` /
      `lastSeedOptions` / `profileWatcher` 维持原状（它们的生命周期跨三个调用点，
      不属本 service）
- [x] `check:all` 通过、全量测试 **330 / 324 / 5**（与 ticket 03 基线一致）
- [x] `dist-local` 出包成功
- [x] 产物哈希：插件 2/2 一致；bridge **14/15**，唯一差异 `desktop-host.js` 来自
      ticket 02（本次未触碰该文件）

## 执行结果

### 前提修正：重叠度被高估

ticket 声称三处「几乎逐字重复」。逐行核对后**不成立**——共 13 个步骤，三处真正相同的只有 4 个：

| 步骤 | startApplication | recycleDsh | restartInRecovery |
|---|---|---|---|
| beginDiagnostic | try 内 | **start 回调内** | try 内 |
| server 赋值 | 是 | 是 | 是 |
| advanceDiagnostic | 是 | 是 | 是 |
| repaired 日志 | **有** | 无 | 无 |
| allowedOrigin | 在 createMainWindow | 同左 | **显式设置** |
| profileWatcher.stop/赋值 | **有** | 无 | 无 |
| openWorkbenchOrRecovery | 有 | 有 | **无（destination 分支）** |
| smoke ready 文件 | **有** | 无 | 无 |
| scheduleStartupUpdateCheck | **有** | 无 | 无 |
| catch 行为 | `return` | **吞掉** | **rethrow** |
| finally(watcher.sync/isRecycling) | 无 | 有 | 有 |

经与用户确认，**缩小范围**：只抽真正共享的 4 个步骤，三处差异**保留在各调用点**，
不参数化合并。理由是那些差异是真实行为而非重复，硬合并会把差异藏进一个大函数的接口里。

### 行为变更（已确认）

`beginDshStartupDiagnostic` 原先在 recycle 路径位于 `start` 回调**内**，另两处在**外**。
该回调可能被自修复逻辑重试，导致诊断重复记录「开始」。现在统一为每次 launch 调用一次，
与另两处一致。这是 ticket 04 唯一的行为变更。

### 顺序保持（易错点）

三处原本都是 **先发布 server、后推进诊断**（`state.runtime.server = result` 在
`advanceDshStartupDiagnostic` 之前）。recovery 路径还额外在两者之间设置 `allowedOrigin`。
service 用 `setServer` 回调精确保持了这个顺序，并在代码注释中标注原因。

### 测试侧

`recovery-scenarios` 用 vm 提取 main.ts 函数执行。`launchDsh` 移出后，VM scope 需要注入它——
选择注入**真实实现**而非 stub，这样测试覆盖的是真实的共享骨架。该文件的 19 条用例
（含断言精确事件序列 `['startup','stop','install','start','workbench','sync']`）全部通过，
说明抽取未改变可观测行为。

另修复 3 处因抽取而过期的源码断言（`state.runtime.server.url` → `started.server.url`）。

主入口从 2151 行降至 **2122 行**（净减 29 行——符合预期，因为三处差异被有意保留）。

- [ ] 人工启动应用确认：首次启动进入工作台、重启动作可用
