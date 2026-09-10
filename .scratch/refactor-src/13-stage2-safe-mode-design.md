# 恢复模式对齐 — 阶段 2：Safe Mode 环境隔离

> 参考实现：`E:/project/dsh/dsh-desktop/dsh-plugin-desktop/src/safe-mode.ts`（200 行）
> 本文档先于实现，记录移植决策、与我们的差异、以及必须守住的语义。

## 一、Safe Mode 是什么

一个**可丢弃、由启动器拥有**的 DSH 环境。用途：当正常环境（`~/.dsh` + 正常
userData）因为插件、配置或 profile 损坏而无法启动时，用一个**完全隔离、固定默认配置**
的环境启动，从而能在不触碰用户真实数据的前提下进应用排障。

关键性质：**Safe Mode 绝不读也可能不写用户的 `~/.dsh`。** 隔离是它的全部意义。

## 二、参考实现的语义（逐条）

### 2.1 路径（`desktopSafeModePaths`）

```
<userData>/safe-mode/                    rootDir（整体可删）
<userData>/safe-mode/dsh-home/           homeDir（隔离的 DSH_HOME）
<userData>/safe-mode/desktop-state/      隔离的 Desktop userData
```

`desktopSafeModePaths` **纯函数、不触碰文件系统**（便于测试与提前引用）。

入参校验：必须是绝对路径、非空、不含 NUL，否则 `TypeError`。

### 2.2 校验（`validMarker` / `isRealDirectory`）

`rootDir` 要被采纳（复用而非重建）必须同时满足：

- `rootDir` 是**真实目录**（`lstatSync` + `isDirectory()` + **`!isSymbolicLink()`**）
- `environment.json` 是**真实文件**（非符号链接）、体积 ≤ 4 KB、JSON 可解析、
  `version === 1`、`createdAt` 是合法 ISO 时间
- `homeDir` 与 `userDataDir` 都是真实目录

**为什么排除符号链接**：否则一个指向 `~/.dsh` 的链接会被当成 Safe Mode 环境，
清理时就会**删掉用户的真实数据**。这是安全边界，不是风格问题。

### 2.3 清理（`cleanupDesktopSafeModeEnvironment`）

- 自写递归删除（不用 `rmSync`），逐个 `lstatSync`：
  - **符号链接或非目录 → `unlinkSync`（只删链接本身，不进入目标）**
  - 目录 → 递归后 `rmdirSync`
- `ENOENT` 视为成功（幂等）
- 对 `EBUSY / EMFILE / ENFILE / ENOTEMPTY / EPERM` **重试 3 次**，退避 `100*(n+1)` ms
  （用 `Atomics.wait` 同步睡眠）
- 返回 `boolean` 表示"是否确实删掉了东西"

### 2.4 重置（`resetDesktopSafeModeEnvironment`）

先清理 → 建 `homeDir` / `userDataDir`（`mode 0700`）→ `chmod` 三者为 `0700` →
**`wx` 独占标志**写 marker（`mode 0600`）。

- `wx` 保证**不会覆盖已存在的 marker**（并发/残留时宁可失败）
- 任一步失败 → **回滚**（再清理一次）→ 抛出

### 2.5 采纳或修复（`ensureDesktopSafeModeEnvironment`）

```ts
if (rootDir 真实目录 && marker 合法 && homeDir 真实目录 && userDataDir 真实目录) return paths
return resetDesktopSafeModeEnvironment(userDataDir)
```

语义：**能复用就复用，不能就重建**。

### 2.6 准备（`prepareDesktopSafeModeEnvironment`）

`reset` 之后额外建一个 profile 并选中：

```ts
createDesktopWebProfile(paths.homeDir, 'desktop-safe-mode')
selectDesktopProfile(<userData>/profile-selection/state.json, paths.homeDir, 'desktop-safe-mode')
```

失败同样回滚。

### 2.7 固定默认值（`DESKTOP_SAFE_MODE_DEFAULTS`）

不弹首次运行向导，直接给一份**功能最小化**的配置：

```
aaEnabled: false
market:    'disabled'
settings:  mode='compatibility', macosMaterial='off', windowsMaterial='off',
           openBrowser=false, networkExposure='loopback',
           notifications: 全 false
```

**注意 `networkExposure: 'loopback'`** —— Safe Mode 只监听回环，不对外暴露。

## 三、我们与参考实现的差异（必须在移植时处理）

### 3.1 我们没有的依赖

| 参考实现用到 | 我们的对应物 | 处理 |
|---|---|---|
| `createDesktopWebProfile(home, name)` | `createProfileDirectory(roots, name)` + `seedBundledPlugins(...)` | 需在 Safe Mode 下也能 seed |
| `selectDesktopProfile(statePath, home, name)` | `writeActiveProfile(roots, name)` | 直接映射 |
| `DesktopMarketProvider` / `DesktopSetupWizardSettings` | **我们没有这套设置模型** | 见 3.2 |

### 3.2 `DESKTOP_SAFE_MODE_DEFAULTS` 不能逐字照搬

参考实现的默认值指向**它自己的设置命名空间**（market provider、setup wizard、
macos/windows material）。我们没有这些概念。

**决策**：本阶段只移植**环境隔离机制**（路径 / 校验 / 清理 / 重置 / 采纳 / 准备），
`DESKTOP_SAFE_MODE_DEFAULTS` 先不移植——因为它的字段在我们的设置模型里没有对应物，
硬搬会造出一份**没人读的配置**（静默无效）。待阶段 5（启动消费标记）确定
Safe Mode 下我们要覆盖哪些设置时，再按我们的设置模型定义。

**这是一个有意的取舍，不是遗漏。**

### 3.3 HOME 的隔离方式

参考实现是把 `DSH_HOME` 指向 `paths.homeDir`。我们启动 DSH 子进程时通过
`startOptions` 传环境（`dsh-process.ts`），需要确认能否注入 `DSH_HOME`。

**待实现时验证**：若我们的子进程环境当前不传 `DSH_HOME`，需新增该注入点。

### 3.4 userData 隔离

参考实现把 Desktop 自己的 userData 也隔离到 `<root>/desktop-state`。
我们的 Electron userData 在 `app.setPath('userData')` 时确定，**必须在
`app.whenReady()` 之前**设置才能生效。这意味着 Safe Mode 的标记要在**很靠前**读取
（早于现有的 `startApplication`）。

## 四、实现清单（阶段 2）

### 4.1 新增 `src/recovery/safe-mode.ts`

移植这些函数（保持与参考同名，便于对照）：

- [ ] `DESKTOP_SAFE_MODE_PROFILE_NAME`
- [ ] `desktopSafeModePaths(userDataDir)`
- [ ] `cleanupDesktopSafeModeEnvironment(userDataDir): boolean`
- [ ] `resetDesktopSafeModeEnvironment(userDataDir, now?): DesktopSafeModePaths`
- [ ] `ensureDesktopSafeModeEnvironment(userDataDir): DesktopSafeModePaths`
- [ ] `prepareDesktopSafeModeEnvironment(userDataDir): DesktopSafeModePaths`（适配我们的 profile API）
- [ ] 内部：`isRealDirectory` / `validMarker` / `removeSafeModeEntry`

### 4.2 单元测试（`test/safe-mode.test.ts`）

必须覆盖：

- [ ] 路径解析是纯函数，不改文件系统
- [ ] 非绝对路径 / 空串 / 含 NUL → `TypeError`
- [ ] `ensure` 在空目录上**重建**
- [ ] `ensure` 在完好环境上**复用**（不重建，`createdAt` 不变）
- [ ] marker 版本错 / JSON 坏 / 体积超限 → **重建**
- [ ] **符号链接的 rootDir → 必须重建（绝不采纳）** ← 安全边界
- [ ] **清理时符号链接只 unlink、不递归进目标** ← 安全边界（防删用户数据）
- [ ] `cleanup` 对不存在的目录返回 `false` 且不抛
- [ ] `cleanup` 幂等（连续两次）
- [ ] `reset` 后 marker 存在、权限为 `0600`（非 Windows）
- [ ] `reset` 的 `wx` 语义：已存在 marker 时不静默覆盖
- [ ] 失败回滚：`reset` 中途失败不留半成品

### 4.3 本阶段**不做**

- 接入启动流程（阶段 5）
- 重启到 Safe Mode 的入口（阶段 4）
- `DESKTOP_SAFE_MODE_DEFAULTS`（见 3.2）
- Safe Mode 的 UI

**本阶段交付物**：一个经过充分单测、可独立验证的隔离环境模块，**尚未接入任何调用方**。
这样风险最小——安全边界（符号链接）能在没有启动流程干扰的情况下测透。

## 五、验收

- `check:all` 通过
- 全量测试基线不破（当前 341 / 335 / 5）
- 新增 safe-mode 用例全绿
- **不做** `dist-local` 出包（本阶段无调用方，出包无验证价值；接入后才需要）
