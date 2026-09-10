# 重构现状评审（补 ticket 前）

对 ticket 01~05 完成后、ticket 06 之前的仓库状态做一次评审，目的是**把剩余缺口摆清楚再补 ticket**。

## 一、已完成部分的实际效果

| 指标 | 起点 | 现在 | 变化 |
|---|---|---|---|
| `src/` 平铺文件 | 45 个，零子目录 | 7 个层目录 | ✅ 结构达成 |
| 模块级可变 `let` | 39 个 | 1 个（`state`） | ✅ 集中完成 |
| `main.ts` 行数 | 2151 | **2178** | ❌ **反而 +27** |
| 顶层函数 | 111 | 110 | 基本未变 |
| 测试基线 | 326/320/5 | 330/324/5 | ✅ 无回归（+3 护栏 +1 解压） |

**关键落差：`main.ts` 没有变小。**

原因是 ticket 04/05 都**保留了薄包装层**：ticket 04 净减仅 29 行（三处差异被有意保留），
ticket 05 **净增 45 行**（移出 227 行，但新增注册表初始化 + 7 个转发包装）。

这不是失败——分层与状态集中确实达成了。但**spec 里写的 `main.ts < 300 行` 这条验收标准
从未做过行数预算**，属于规划失误。

## 二、`main.ts` 剩余 2178 行的实际构成（实测）

按顶层函数边界逐段统计：

| 分组 | 函数数 | 行数 | 现有 ticket |
|---|---|---|---|
| 通知 | 11 | 199 | 06 |
| 更新器 + 托盘 | 14 | 270 | 06 |
| shell IPC | 11 | 328 | 07 |
| **恢复流程** | 16 | 260 | **无** |
| **终端** | 4 | 179 | **无** |
| **profile IPC** | 6 | 69 | **无** |
| **对话框窗口** | 3 | 89 | **无** |
| **主题广播** | 6 | 59 | **无** |
| 薄包装（04/05 引入） | 7 | 28 | 无 |
| `startApplication` | 1 | 172 | 入口，保留 |
| 其余编排/错误/消息 helper | ~31 | ~480 | 入口，保留 |

**缺口 = 656 行没有任何 ticket 覆盖。**

## 三、补 ticket 后的预期

```
2178
 -469   ticket 06
 -328   ticket 07
 -656   新增 ticket 09~13
 = 725 行残留
```

725 行的构成是 `startApplication`(172) + `handleDshIpc`(48) + `recycleDshForPluginUpdate`(43)
+ `handleRendererBootReport`(48) + 薄包装(28) + 各类启动/错误/消息 helper。

**这是合理的「入口 + 编排」残留，但离 300 行差很远。**

要达到 <300 行，还得把 `startApplication`（172 行）也拆开——而实测显示它内部是
10 段**有意义**的编排步骤（加载偏好 → 建 store → 绑定注册表 → 解析路径 → 解压 →
补种 → 启动 → 打开界面 → 写 smoke 文件 → 排更新检查），不是可清理的杂波。

**结论：`<300 行` 这条目标应当修正**，改成「入口只做编排、各域独立成模块」这类
可达成的表述，而不是一个从未预算过的数字。

## 四、各新增分组的耦合实测（决定能否独立成模块）

| 分组 | 依赖的 store 分组 | 对外调用 | 可独立？ |
|---|---|---|---|
| 终端 | **仅 `launch`（1 个字段）** | `readActiveProfile` | ✅ 最强候选 |
| 对话框窗口 | 无 state 依赖 | 无 | ✅ 最干净 |
| 主题广播 | `shell` + `windows` | 无 | ✅ 干净 |
| profile IPC | `launch` + `runtime` | `readActiveProfile` / `writeActiveProfile` | ✅ 干净 |
| 恢复流程 | 2~4 个分组不等 | `createWindow` / `showStartupWindow` | ⚠️ 需注入 |

**终端的实测数据印证了 spec 的预测**：`openDshTerminal`（159 行）只依赖 `lastSeedOptions`
**一个字段**——这是实施窄接口签名（ticket 03 遗留项）的最佳落点。

## 五、恢复流程的反向依赖（决定 blocking edge）

`recovery` 组被这些外部函数调用：

| 被调用者 | 调用方 |
|---|---|
| `maybeLeaveRecoveryMode` | `handleRendererBootReport`、`openWorkbenchOrRecovery`、`returnToWorkbenchFromRecovery` |
| `presentDshLoadFailure` | `handleRendererBootReport` |
| `reportStartupFailure` | `handleUnexpectedMainError`、`recycleDshForPluginUpdate`、`startApplication` |
| `recoveryPageStatus` / `requireRecoveryProfile` / `restartDshInRecoveryMode` | `installRecoveryIpc`、`restartIntoRecoveryFromShell` |
| `showRecoveryWindow` | `openWorkbenchOrRecovery` |

即：**恢复流程与编排层双向依赖**（编排调用 recovery，recovery 也调用编排的
`handleRendererBootReport` 等）。这决定了它必须在 06/07 之后做，且需要注入依赖。

## 六、结论

1. **结构目标已达成**：分层、状态集中、三个模块抽出、晚绑定护栏。
2. **行数目标未达成且原目标不合理**：`<300 行` 应改为可达成的表述。
3. **补 5 个 ticket（09~13）** 覆盖 656 行缺口，让分解完整。
4. **终端分组顺带落实 ticket 03 遗留的「窄接口签名」**——它有最强的实测依据。
