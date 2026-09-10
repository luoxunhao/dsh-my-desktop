# 恢复模式对齐 — 阶段 3：健康启动快照（checkpoint）

> 参考实现：`E:/project/dsh/dsh-desktop/dsh-plugin-desktop/src/profile-checkpoint.ts`（895 行）
> 本文档先于实现，重点记录**移植时必须处理的可移植性风险**。

## 一、它解决什么问题

用户把 profile 改坏（加了个不兼容插件、改错 `cordis.patch.yml`）导致启动失败。
如果没有快照，唯一出路是手动改文件或删 profile 重建。

快照机制：**每次健康启动时把「声明式配置」拍一份**，保留 3 个滚动槽。
启动失败时可以从任意槽恢复到某个已知良好状态。

## 二、设计要点（参考实现）

### 2.1 只快照声明式文件，绝不碰 node_modules

```
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
cordis.patch.yml
.dsh-market/state.json
home/settings.yaml          ← 见第三节（可移植性风险）
home/cordis.patch.yml       ← 见第三节
```

每文件有上限：`pnpm-lock.yaml` 32 MB，`home/settings.yaml` 4 MB，其余 1 MB。

**恢复永不运行 pnpm、永不拷贝 node_modules。** 只回滚这几个声明式文件。
依赖差异由「依赖物化」另行标记（见 2.4）。

### 2.2 三个滚动槽

`slot-1` / `slot-2` / `slot-3`（固定，非动态）。

捕获时的选槽逻辑：

1. 优先选**空槽**（`!slot.snapshotExists`）
2. 全满则选 **`capturedAt` 最早**的（按时间升序，时间相同用 `slotId` 字典序兜底）

### 2.3 skip marker（防止把坏状态拍进快照）

恢复之后**第一次**健康启动，**不覆盖任何快照**，而是消费掉一个 skip marker：

```ts
if (skip !== undefined) {
  unlinkSync(join(this.profileRoot, SKIP_MARKER_FILENAME))
  return { status: 'skipped-after-restore', restoredSlotId: skip.restoredSlotId }
}
```

**为什么必须这样**：恢复后第一次启动只是验证"这个恢复点能不能起来"。如果能起来
就立刻把它当成新的健康点拍进某个槽，就会**挤掉另一个可能更有价值的旧快照**。
skip marker 让这次"验证性启动"不产生快照。

### 2.4 先写 marker 再改文件

`restoreSlot` 的注释说明了顺序理由：

> Persist before mutation. A failed restore must not cause a later healthy startup
> to overwrite the selected recovery point accidentally.

即：**先落 marker，再改配置**。若恢复中途失败，marker 已经记下"我曾试图恢复到 slot-N"，
下次健康启动会走 skip 分支而**不会覆盖那个恢复点**。

marker 还带 `dependencyMaterializationPending` 位：若改动了
`package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`，则该位为真，
需要重新做依赖物化——**且失败后可重试**（即使声明式文件已经与快照一致）。

### 2.5 原子替换 + 孤儿槽恢复

- 捕获先写 `<profile>/.staging-<slotId>-<pid>-<uuid>/`，成功后 `replaceSlot()` 原子换入
- 失败则 `rmSync(staging)` 清理
- 启动时 `recoverOrphanedSlots()` 处理上次崩溃残留的 staging 目录

### 2.6 持久化写入（`writeDurable`）

写文件后 `fsyncSync` 再关（`writeDurable`），保证崩溃时不留半写文件。
权限：文件 `0600`、目录 `0700`（非 Windows 才检查）。

### 2.7 跨版本兼容

manifest 有 v2 / v3 / v4 三个版本，读取时都接受：

- v2：只有 `legacy` 文件集（5 个）
- v3：加入 `home/*` 两个文件
- v4：加入 `desktopPackageName` / `releaseChannel` / `dshVersion`

`checkpointFiles(version)` 按版本返回对应的文件清单。

## 三、⚠️ 可移植性风险（本阶段最重要的一节）

### 3.1 `home/` 是逻辑前缀，不是真实目录

参考实现（`profile-checkpoint.ts:476-478`）：

```ts
if (name === 'home/settings.yaml') return join(homeDir, 'settings.yaml')
if (name === 'home/cordis.patch.yml') return join(homeDir, 'cordis.patch.yml')
return filePath(profileDir, name)
```

**前两个走独立的 `homeDir`，其余走 `profileDir`。**

### 3.2 我们的实际布局（实测）

| 概念 | 值 |
|---|---|
| homeDir | `~/.dsh` |
| profileDir | `~/.dsh/profiles/<name>` |
| `settings.yaml` 实际位置 | **`~/.dsh/settings.yaml`** ✅ |
| profile 下有 `home/` 子目录 | **否**（实测不存在） |

### 3.3 结论与陷阱

`home/settings.yaml` 在**我们的布局里必须解析到 `~/.dsh/settings.yaml`**。

**陷阱**：如果照字面在 profile 下创建 `home/` 目录并往里写，会得到

- 一个**永远不会被 DSH 读取的** `~/.dsh/profiles/web/home/settings.yaml`
- 快照"成功"（文件确实存在、hashes 对得上）
- 但恢复时**恢复不到任何有用的东西**——用户的真实 `settings.yaml` 从未被备份

**这是静默失效**：没有任何报错，测试如果只断言"快照文件存在"也会通过。

### 3.4 防御措施（必须实现）

1. **单测直接断言解析结果**：`targetPath(profileDir, homeDir, 'home/settings.yaml')`
   必须等于 `<homeDir>/settings.yaml`，**不等于** `<profileDir>/home/settings.yaml`
2. **断言不创建 `home/` 子目录**：捕获后 `profileDir/home` 不应存在
3. **往返测试（round-trip）**：写 markera → 捕获 → 改 homeDir 的
   `settings.yaml` → 恢复 → 断言**真实文件**被还原。这个测试能抓住所有路径映射错误。

## 四、我们要做的取舍

### 4.1 manifest 版本

参考实现要兼容 v2/v3/v4（它有历史包袱）。**我们从零开始，只实现 v4 一个版本**，
但保留 `version` 字段以便将来演进。不实现 v2/v3 的读取分支——**我们没有那些历史数据**，
实现了也无法测试。

### 4.2 `desktopPackageName` / `releaseChannel`

参考实现用于多发行版共存时识别"这个快照属于哪个版本渠道"。
我们只有一个发行版，**先保留字段但不做准入判断**（字段写入 manifest，读取时不校验）。

### 4.3 `provider` / `profileIdentity`

- `profileIdentity` = `sha256(profileDir)`，用于区分不同 profile 的快照
- `provider` = market provider 名；**我们没有 market provider**，用固定值 `'local'`

### 4.4 本阶段不做

- **不接入启动流程**（阶段 5 才在健康启动时调用 `captureHealthy()`）
- **不做 preview/execute 两阶段确认**（阶段 6，属于控制器层）
- **不做 UI**

**本阶段交付物**：一个经过往返测试的 checkpoint 存储模块，未接入调用方。

## 五、实现清单

### 5.1 新增 `src/recovery/profile-checkpoint.ts`

- [ ] 常量：3 个槽位、文件清单、版本、上限、权限、路径名
- [ ] `targetPath(profileDir, homeDir, name)` —— **路径映射的单一真相**
- [ ] `createDesktopProfileCheckpoint(options)` 工厂
- [ ] 方法：`listSlots()` / `captureHealthy()` / `inspectSlot()` / `restoreSlot()` /
      `completeDependencyMaterialization()`
- [ ] 内部：`readCurrentImages` / `replaceSlot` / `recoverOrphanedSlots` /
      `recoverOrphanedSlot` / `readSkipMarker` / `readSnapshot` / `writeDurable` /
      `ensureDirectory` / `fileEqual`
- [ ] `clearDesktopProfileCheckpoint(userDataDir, profileDir)`

### 5.2 单元测试（`test/profile-checkpoint.test.ts`）—— 用临时目录

**路径映射（最高优先，见 3.4）**

- [ ] `home/settings.yaml` → `<homeDir>/settings.yaml`，**不是** profile 下的 `home/`
- [ ] 其余 5 个 → `<profileDir>/<name>`
- [ ] 捕获后 profile 下**不出现** `home/` 目录

**快照与恢复**

- [ ] 捕获写入内容与 manifest 正确（files/present/sha256/size）
- [ ] **往返**：改 `~/.dsh/settings.yaml` → 恢复 → 真实文件被还原
- [ ] `inspectSlot` 正确报告 `currentDiffers` 与 `changedFiles`
- [ ] 从空 profile 恢复（文件不存在当作 `present: false`）

**槽位轮转**

- [ ] 空槽优先
- [ ] 三个全满 → 替换 `capturedAt` 最早的
- [ ] 时间相同时用 `slotId` 兜底（确定性）

**skip marker**

- [ ] 恢复后首次 `captureHealthy()` 返回 `skipped-after-restore` 且**不**改动任何槽
- [ ] marker 被消费后，第二次捕获正常拍快照
- [ ] 恢复**先**写 marker（模拟恢复中途失败，marker 仍在）

**健壮性**

- [ ] 残留 staging 目录被 `recoverOrphanedSlots` 清理
- [ ] 损坏的 manifest（JSON 坏 / 版本错）不影响其它槽
- [ ] 文件超过上限 → 处理方式（跳过该文件并记 `present: false`，或以 `too-large` 失败）
- [ ] `clearDesktopProfileCheckpoint` 清空所有槽

## 六、验收

- `check:all` 通过
- 全量测试基线不破（阶段 2 之后的新基线）
- **往返测试必须真绿**（这是唯一能抓住路径映射错误的测试）
- **不做** `dist-local`（本阶段无调用方）

---

## 七、实施结果（已完成）

`src/recovery/profile-checkpoint.ts`（约 420 行）+ `test/profile-checkpoint.test.ts`（14 条）。
全量测试 **373 / 367 / 5**（新增 14 条，5 项已知缺口不变），`check:all` 通过。
模块在测试外**零引用方**（未接入启动流程）。

### 7.1 设计里预判的静默失效风险 → 已用三条测试锁死

设计第三节的核心担忧是：`home/*` 若被朴素拼接到 profileDir，快照会"成功"但备份到
**DSH 永不读取的路径**。实施时按设计 3.4 的要求落地了三层防御，并做了**反向验证**：

把 `resolveCheckpointTarget` 里的 `home/*` 分支去掉后，**三条测试同时失败**：

- `home/* 解析到 homeDir，其余解析到 profileDir`（直接断言解析结果）
- `home/* 绝不落到 profile 下`（用 `relative()` 判断是否逃出 profile）
- `往返：改真实 home 文件后恢复，文件被还原`（**端到端**证明映射正确）

第三条是关键——它不依赖任何路径断言，而是**真的改一个文件、恢复、再读回来**。
即使前两条被误删，它仍能抓住映射错误。

### 7.2 只实现 manifest v4（按设计 4.1）

没有 v2/v3 的历史数据，实现了也无法测试，故只保留 v4；`checkpointFiles(version)`
对非 v4 直接抛错，而不是静默降级。

### 7.3 与参考实现的差异（有意）

| 项 | 参考实现 | 我们 |
|---|---|---|
| `desktopPackageName` / `releaseChannel` / `dshVersion` | manifest v4 字段 + 准入判断 | **不做准入判断**，只有一个发行版 |
| `provider` / `profileIdentity` | manifest 字段 | 用 `profileName` 定位快照目录 |
| 跨版本读取（v2/v3/v4） | 三种都读 | 只读 v4 |
| `assertTargetParent`（父目录 realpath 校验） | 有 | **未移植**（见 7.4） |

### 7.4 未移植的一项（如实记录）

参考实现有 `assertTargetParent`：在读写前校验目标文件的**父目录**是真实目录、
非符号链接，并 `realpathSync` 一次。

**未移植。** 理由：我们的 `resolveCheckpointTarget` 只在两个固定根下拼路径，
父目录要么是 `profileDir`/`homeDir` 本身、要么是 `.dsh-market` 这样的固定子目录，
不存在参考实现里"profileDir 可能被换成链接"的威胁模型（它是可配置的任意路径）。
若阶段 5 接入启动流程后发现 profileDir 可能不可信，应补上。

### 7.5 实施中的两次测试自查

1. **"恢复中途失败" 测试初始写错了断言对象**：我试图用「在目标位置放一个目录」
   制造写阶段失败，但该障碍会在 `readCurrentImages` 的**预检阶段**就抛错，
   即发生在 marker 写入**之前**。核对参考实现后确认**它的顺序也一样**，
   我的实现是忠实的——是测试的前提错了。改为直接断言顺序要保护的可观测结果
   （恢复后下次健康启动不覆盖槽位）。

2. **`completeDependencyMaterialization` 的调用顺序写反**：`captureHealthy` 会
   **消费** marker，所以必须**先**完成物化、**后**让启动消费。写反后实现正确地
   拒绝了调用（"does not match the active restore"）——是测试错、实现对。
---

## 八、评审修复（双轴评审发现的问题）

对阶段 3 做了 Standards + Spec 双轴并行评审。**两个轴独立地抓到同一个严重缺陷**，
另有若干部分缺口。全部已修并补测。

### 8.1 【严重】一个槽损坏会永久禁用整个快照机制

原 `readSnapshot` 直接 `JSON.parse` 后 `throw`。后果实测：

```
listSlots THREW: Expected property name or '}' in JSON ...
captureHealthy THREW: Expected property name or '}' ...
  ← 一个损坏的槽阻断了所有快照
```

因为**每次健康启动都会拍快照**，所以一个字节坏掉 → `listSlots()` 抛错 →
`captureHealthy()` 抛错 → **整个快照功能永久失效**，连健康的槽也一起废掉。
这正好违背三个槽"互为独立恢复点"的设计意图。

参考实现在这点上是**刻意宽容**的（其注释：
"Browseable checkpoint metadata must not make a restorable slot disappear"），
阶段 2 的 `safe-mode.ts` 也是返回 false 而非抛出 —— 只有阶段 3 写成了抛错。

**修复**：`readSnapshot` 对 manifest 坏 JSON / 版本不符 / 文件数不符 / `capturedAt`
不合法 / 目录不可读，一律**返回 `undefined`（视为空槽）**，绝不外抛。
未知版本（如降级后遇到 v5）同样视为空槽，且**不会被静默改写成 v4**——
只是被后续捕获当作空槽回收。

**反向验证**：恢复成抛错后，两条新测试立即失败。

### 8.2 崩溃残留的 staging 目录从不清理

`recoverOrphanedSlots` 只处理 `<slot>.old-*`，**从不处理 `.staging-*`**。
实测：植入 `slot-1.staging-999-deadbeef/` 后跑 `captureHealthy()`，目录**存活**。
进程内 `catch` 只能覆盖正常展开的失败，**硬崩溃会永久泄漏**，且没有任何其它清理者。

**修复**：同时清理 `.staging-*`（丢弃半成品）并恢复 `.old-*`（它是完整快照，
是有效的恢复点，必须放回）。两种残留语义不同，注释里写明。

### 8.3 目录权限 0700 未实现

设计 §2.6 要求文件 `0600`、目录 `0700`。原 `ensureDirectory` 是裸 `mkdirSync`，
POSIX 下目录会拿到 umask 默认的 **0755**，把文件哈希与结构暴露给同机其它用户。

**修复**：新增 `DIRECTORY_MODE = 0o700` 与 `CHECK_POSIX_MODE`（Windows 跳过），
`ensureDirectory` 显式 chmod（`mkdirSync` 的 mode 会被 umask 掩掉，故必须 chmod）。
同时补上**父目录 fsync**（原地重命名后父目录不 fsync，掉电可能丢失该条目）。

### 8.4 `clearDesktopProfileCheckpoint` 未导出

设计 §5.1/§4.2 要求它作为独立入口（参考实现的 profile 删除路径要用），
原实现只有实例方法 `clear()`。已补导出。

### 8.5 两条测试是弱/同义反复（已修）

- **「三槽全满后替换最早的」的 `now` 覆盖是死的**：ISO 字符串截断到毫秒，
  `clock++` 产生的三个时间戳**完全相同**，于是实际走的是 slotId 兜底分支，
  而**名字里写的"时间戳分支"从未被测到**。改为每次前进 1 分钟。
  并**拆成两条测试**：一条测时间戳分支，一条测相同时间戳下的 slotId 兜底。
- 删除两处同义反复断言：`deepEqual([...SLOT_IDS], [...])`（与常量自身比较）、
  `captured.includes('slot-1')`（循环上限为 3 且槽位互异，恒真）。

### 8.6 评审确认无问题、且经反向验证的部分

- **§3.4 的三层路径映射防御全部到位**，反向验证：去掉 `home/*` 分支后三条测试同时失败
- §2.2 空槽优先 + 最早时间戳 + slotId 兜底，与设计逐条一致
- §2.3 marker 确实被消费（`unlinkSync`）
- §2.4 marker 先于任何文件修改落盘，`dependencyMaterializationPending` 语义正确
- §2.5 `replaceSlot` 两个分支都真正原子，四次捕获后无残留
- §2.1 超限文件**抛错而非静默截断**，上限与设计一致
- 恢复时的哈希复验（"checkpoint changed during restore"）与符号链接拒绝**均忠实移植**

### 8.7 保留的分歧与遗留（`assertTargetParent`）

设计 §7.4 以"路径只来自两个固定根，profileDir 不可能被换成链接"为由未移植
`assertTargetParent`。Spec 轴评审**不认同这个前提**：`DSH_HOME` 是环境变量，
而 `safe-mode.ts` 自己就会覆写它，所以"非攻击者可控"的说法比 §7.4 声称的弱。

**接受这条意见**，但维持**本阶段不移植**：本阶段模块测试外零引用方，没有真实调用路径；
待阶段 5 接入启动流程、这些路径真正获得调用方时补上。已在 §7.4 与本节记录。