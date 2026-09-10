# 09 — 抽出终端服务（并首次落地窄接口签名）

**What to build:** `openDshTerminal` 及其辅助函数独立成模块，让"打开 DSH 终端"这件事有
单一归属。

**实测依据（这是全仓最强的独立案例）**：`openDshTerminal` 有 **159 行**，但对 store 的
依赖只有 **`lastSeedOptions` 一个字段**。spec 在 ticket 03 时预测「terminal 只需 1 组字段」，
这里是该预测的实测确认。

**本 ticket 顺带落实 ticket 03 遗留的窄接口签名**：`openDshTerminal` 是第一个可以真正声明
窄签名的函数——它不需要整个 store，只需要一个字段。这为后续模块建立了示范。

**Blocked by:** 05 — 抽 DesktopWindowRegistry

**Status:** ready-for-agent

- [ ] 抽出终端模块：`openDshTerminal`、`logTerminalError`
- [ ] **首次落地窄接口签名**：模块接收 `{ lastSeedOptions }` 这类只含所需字段的 deps，
      而不是整个 `DesktopState`（结构类型自动兼容，运行时仍是同一个 store 对象）
- [ ] 终端 shim 生成、PATH 注入逻辑原样保留（只注入该终端进程，不动系统 PATH）
- [ ] 保留「不带 `--profile` 即操作当前 profile」的行为与提示文案
- [ ] `check:all` 通过、全量测试不新增失败
- [ ] `dist-local` 出包成功
- [ ] **人工启动确认**：顶栏「终端」按钮能打开终端，且终端内 `dsh --version` 可用

**备注**：本 ticket 是「窄接口签名」这一 ticket 03 遗留项的落地示范。若实际做起来发现
只传 1 个字段不够（存在未实测到的隐式依赖），**如实记录实际需要的字段**，不要为了凑数
硬塞整个 store。
