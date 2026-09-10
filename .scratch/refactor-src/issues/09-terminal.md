# 09 — 抽出终端服务（并首次落地窄接口签名）

**What to build:** `openDshTerminal` 及其辅助函数独立成模块，让"打开 DSH 终端"这件事有
单一归属。

**实测依据（这是全仓最强的独立案例）**：`openDshTerminal` 有 **159 行**，但对 store 的
依赖只有 **`lastSeedOptions` 一个字段**。spec 在 ticket 03 时预测「terminal 只需 1 组字段」，
这里是该预测的实测确认。

**本 ticket 顺带落实 ticket 03 遗留的窄接口签名**：`openDshTerminal` 是第一个可以真正声明
窄签名的函数——它不需要整个 store，只需要一个字段。这为后续模块建立了示范。

**Blocked by:** 05 — 抽 DesktopWindowRegistry

**Status:** 代码完成，**待人工验证**

- [x] 抽出 `src/desktop/terminal-service.ts`：`openDshTerminal`、`logTerminalError`
- [x] **首次落地窄接口签名**：`TerminalDeps` 只声明 3 个字段（见下），**不含 `state`**
- [x] 终端 shim 生成、PATH 注入逻辑原样保留（只注入该终端进程，不动系统 PATH）
- [x] 保留「不带 `--profile` 即操作当前 profile」的行为与提示文案
- [x] `check:all` 通过、全量测试 **335 / 329 / 5**（与基线一致，无需改测试）
- [x] `dist-local` 出包成功
- [ ] **人工启动确认**：顶栏「终端」按钮能打开终端，且终端内 `dsh --version` 可用

## 执行结果

### 窄接口签名（本 ticket 的核心示范）

```ts
export interface TerminalDeps {
  lastSeedOptions: () => RetainedSeedOptions | undefined
  locale: () => string
  profileRoots: () => ReturnType<typeof resolveProfileRoots>
}
```

**没有 `state` 字段。** 调用点一眼能看出：打开终端不碰窗口、更新、通知、恢复任何状态。

实测确认 ticket 的预测**精确成立**——159 行代码对 store 的依赖只有
`state.launch.lastSeedOptions` **一个字段**（5 处引用），无其它 store 分组。

`lastSeedOptions` 通过 **getter** 传入而非取快照，因为它晚绑定：终端可能在首次启动
记录 seed options 之前就被打开。

### 与预测的差异（如实记录）

ticket 说「只需 1 组字段」，实际还多了两个**非 store 依赖**：

| 依赖 | 用途 |
|---|---|
| `locale()` | 中英文欢迎语 |
| `profileRoots()` | 未启动时读注册表拿当前 profile 名 |

两者都是纯函数，不是状态，所以没有污染窄接口的性质。数量从 1 变 3，但**性质未变**：
仍不依赖任何 store 分组以外的状态。

### 实测验证（比"能启动"更强）

启动应用并确认终端 shim **真的被重新生成**（时间戳与运行时刻一致）：

```
cli/<hash>/launch.cmd     252 bytes  15:21:05
cli/<hash>/welcome.cmd    540 bytes  15:21:05
cli/<hash>/bin/dsh-term.mjs 715 bytes 15:21:05
cli/<hash>/bin/dsh.bat    226 bytes  15:21:05
cli/<hash>/bin/dsh.cmd    226 bytes  15:21:05
```

`launch.cmd` 内容正确（`start "DSH My Desktop" /D <profileDir> cmd /D /K call <welcome>`）。
这证明 `openDshTerminal()` 走完了解析 → shim 生成 → broker 编写的完整路径。

另确认：DSH 服务监听 `127.0.0.1:10102`、首页 401（token 门禁）、无 `startup-error.log`。

主入口 1661 → **1532 行**。


**备注**：本 ticket 是「窄接口签名」这一 ticket 03 遗留项的落地示范。若实际做起来发现
只传 1 个字段不够（存在未实测到的隐式依赖），**如实记录实际需要的字段**，不要为了凑数
硬塞整个 store。
