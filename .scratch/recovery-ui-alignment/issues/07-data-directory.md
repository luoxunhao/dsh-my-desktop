# 07 — 数据目录状态与切换（新建后端）

**What to build:** 建立"数据目录"这一概念——状态文件、来源判定三态、切换流程与排他锁，
并让 `resolveProfileRoots()` 消费它。

**Blocked by:** 03

**Status:** ready-for-agent

## 实测依据：这是从零建立概念，不是暴露已有能力

我们目前**没有任何数据目录概念**，路径写死在：

```
profiles.ts:256  const home = options.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
```

参考实现对应后端约 **360 行**（`desktop-data-directory.ts`）+ 145 行操作锁。

## 关键决策：改 `resolveProfileRoots()` 的解析优先级

**不要**靠写 `process.env.DSH_HOME` 让它生效。

实测：`resolveProfileRoots()` 是**唯一汇聚点**——`main.ts`、`profile-actions-service`、
`desktop-host`、`safe-mode` 全部经它解析，且**真实调用都传 `{ stateDir }` 不传 `home`**，
所以 `home` 总是来自 `DSH_HOME ?? ~/.dsh`。

改这一处即可让所有下游同时跟上。反之只改环境变量，一旦哪条路径没读到，
就会出现"改了目录但仍在读旧目录"的**静默失效**——与阶段 3 的路径映射陷阱同类。
**而且我已经栽过一次**：阶段 2 就是因为漏设 `DSH_HOME`，导致 Safe Mode 的隔离被完全绕过。

## 三态优先级

1. `environment` —— `DSH_HOME` 显式设置时优先，**视为用户接管、只读**
2. `desktop` —— 用户在恢复页选过的目录（userData 下的状态文件）
3. `default` —— `~/.dsh`

环境变量优先的理由：用户显式设了就该尊重，否则恢复页改一次目录会让人以为环境变量失效。

## 交付物

- [ ] 数据目录状态文件（版本化，与 `profile-registry.json` 同层）
- [ ] 来源判定：`default` / `environment` / `desktop`
- [ ] `resolveProfileRoots()` 消费该优先级（**唯一改动点**）
- [ ] 切换流程 + 排他锁（防并发与连点）
- [ ] IPC：读取状态 / 选择目录 / 恢复默认

## 必须守住的约束

- [ ] 目标必须**绝对路径、存在、且是真实目录**（**拒绝符号链接**——与阶段 2/3 一致的安全边界）
- [ ] **不迁移数据**：只改指向。UI 必须说清"数据不会自动搬过去"
- [ ] **不立即生效**：写完状态需重启（与 profile 切换同构）
- [ ] **拒绝危险目标**：文件系统根、当前 userData、以及任何**包含受保护路径**的目录
- [ ] `DSH_HOME` 已设时**明确报告为只读**，且不写入状态文件

## 验收

- [ ] 单测覆盖：三态优先级、危险目标拒绝、符号链接拒绝、不存在路径拒绝、
      状态文件损坏时的回退、并发切换被锁挡住
- [ ] **反向验证**：去掉每条安全保护后，对应用例必须失败
- [ ] 全量测试基线不变（406 / 400 / 5）

## 不做

- 不迁移数据
- 不做出厂重置（ticket 08）
- 不接 UI（ticket 05）
