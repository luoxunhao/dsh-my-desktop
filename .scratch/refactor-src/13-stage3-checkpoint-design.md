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
