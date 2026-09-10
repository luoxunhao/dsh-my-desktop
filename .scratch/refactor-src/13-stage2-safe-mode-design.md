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

---

## 六、实施结果（已完成）

`src/recovery/safe-mode.ts`（约 200 行）+ `test/safe-mode.test.ts`（13 条）。
全量测试 **354 / 348 / 5**（新增 13 条，5 项已知缺口不变），`check:all` 通过。

### 6.1 移植的函数

`DESKTOP_SAFE_MODE_PROFILE_NAME`、`desktopSafeModePaths`、
`cleanupDesktopSafeModeEnvironment`、`resetDesktopSafeModeEnvironment`、
`ensureDesktopSafeModeEnvironment`、`prepareDesktopSafeModeEnvironment`
（全部与参考实现同名），外加一个便于调用的 `desktopSafeModeProfileDir`。

`prepareDesktopSafeModeEnvironment` 适配了我们的 profile API：
`createProfileDirectory(roots, name)` + `writeActiveProfile(roots, name)`。
实测确认它建出 profile（含 `package.json` 等声明式文件）并把隔离注册表指向
`desktop-safe-mode`。**注意：依赖尚未 seed**（见 6.4 缺陷 2），seed 需要 `desktopRuntimeDir`
等启动期信息，属阶段 5。

### 6.2 ⚠️ 一次「反向验证失败」的如实记录

按 TDD 纪律我做了变异测试：删掉实现里的安全检查，看测试是否会失败。
**第一轮两个变异都没被测试抓住**，追查后发现两个不同原因：

**变异 1（去掉 `isRealDirectory` 的 `!isSymbolicLink()`）——测试通过，但原因不是缺陷。**

原因：`ensure` 的判定是 `isRealDirectory(rootDir) && validMarker && ...` 的**与**关系。
我最初的测试里，符号链接目标**没有** `environment.json`，所以 `validMarker` 本就会失败、
`ensure` 本就会重建——**符号链接这条路径根本没被走到**，测试是"因为别的原因通过"的。

修正：让链接目标变成一个**完整可采纳的环境**（正确版本的 marker + 两个子目录），
这样唯一的拒绝理由就是符号链接本身。

**变异 2（去掉 `removeSafeModeEntry` 的 `isSymbolicLink()`）——测试仍然通过，这次是
平台语义导致的。**

实测确认：**Windows 上 junction 的 `lstatSync().isDirectory()` 返回 `false`**，
所以即使删掉显式的符号链接判断，它也会落到 `unlinkSync` 分支、不会递归穿透。
而真正的目录符号链接在 Windows 上**无法创建**（`EPERM`，需提权）。

**结论：这个显式判断在当前平台上测不到（unreachable），它真正保护的是 POSIX** ——
在 POSIX 上目录符号链接的 `isDirectory()` 为 `true`，没有该判断就会被递归进去。

处理方式：**不假装它被测试覆盖**，而是新增一条测试把平台事实**断言下来**
（`isSymbolicLink()===true` 且 Windows 下 `isDirectory()===false`），
并在注释里写明「别因为测试全绿就把这个判断删掉」。这样后来者不会误删一个
在 Linux/macOS 上真正救命的检查。

同时把「rootDir 是符号链接」那条测试的注释改为如实描述：它**固定的是可观测契约**，
而保护由两个机制共同提供（纵深防御），去掉任一个单测仍会通过。

### 6.3 仍然有效的两条边界

- **rootDir 是符号链接 → 绝不采纳**（`ensure` 会重建为真实目录）
- **清理遇到符号链接 → unlink，不递归进目标**

两条都由测试固定其**可观测结果**（受害者文件存活、rootDir 不再是链接）。

### 6.4 代码评审发现的两个真实缺陷（已修）

对阶段 2 做了双轴评审（Standards + Spec 并行子代理）。Spec 轴抓到一个
**会让整个功能静默失效**的缺陷，我实测确认后修复。

#### 缺陷 1（HIGH，已修）：隔离在真实启动路径上被完全绕过

原来 `prepareDesktopSafeModeEnvironment` 是这样写的：

```ts
const roots = resolveProfileRoots({ stateDir: paths.userDataDir, home: paths.homeDir })
```

**问题**：真实启动器（`main.ts:319`）是这样解析的 ——

```ts
resolveProfileRoots({ stateDir: app.getPath('userData') })   // 不传 home！
```

不传 `home` 时，`resolveProfileRoots` 回退到
`process.env.DSH_HOME ?? ~/.dsh`。所以真实启动时会解析到**真实的 `~/.dsh`**，
读到（或不读到）隔离注册表后选中**真实的 profile** —— 隔离被完全绕过，
正是本功能最不能发生的事。

**实测证据**（修复前）：

```
真实启动器 home:     C:\Users\admin\.dsh          ← 逃出隔离
真实启动器选中的 profile: web                      ← 真实 profile
隔离环境本意应在: <ud>\safe-mode\dsh-home\profiles\desktop-safe-mode
```

**为什么测试没抓住**：我原来的测试直接断言
`<stateDir>/profile-registry.json` 存在且 `active === 'desktop-safe-mode'`，
而 `writeActiveProfile` 确实是写到那里的——**测试断言的是实现，而不是启动器的
真实解析路径**，所以它天然为绿。

**修复**：`prepare` 在解析 roots **之前**设置 `process.env.DSH_HOME = paths.homeDir`，
使任何后续 `resolveProfileRoots()`（传不传 `home`）都落在隔离边界内。
并新增回归测试**按启动器的方式**调用 `resolveProfileRoots({ stateDir })`（不传 home），
断言解析出的 home 与最终 profile 目录都在隔离根内。

**反向验证**：移除 `DSH_HOME` 注入后，两条新测试均失败 —— 回归确实被抓住。

#### 缺陷 2（MED，已修）：seed 缺失

设计 3.1 要求 `createProfileDirectory` + `seedBundledPlugins`（"需在 Safe Mode 下也能 seed"），
但实现只调了前者，而 `createProfileDirectory` 的文档明说是
"scaffold only; no seed/selection yet"。真实调用方（`profile-actions-service.ts:98,102`）
是两者都做的。

**处理**：这是**有意的阶段切分**，但原文档 6.1 声称 prepare「实测确认建出可用 profile」
**属于措辞过度**。已在文档中改为准确描述：prepare 建出的是**已 scaffold、已选中**的
profile，**依赖尚未 seed**；seed 需要 `desktopRuntimeDir` 等启动期信息，属阶段 5。

#### 评审同时确认无问题的部分

- 设计 2.2 的**七条 marker 采纳条件全部实现且与参考实现逐字一致**
- `CLEANUP_RETRY_CODES` + `Atomics.wait` 退避、`wx` 标志、两处回滚
  **均与参考实现一致，无静默删减**
- `DESKTOP_SAFE_MODE_DEFAULTS` 确实未移植，理由仍成立
- 无启动/重启/UI 接线泄漏（模块在测试外零引用方）

### 6.5 评审提出、我核实后处理的其他项

- **移除** `export { DEFAULT_PROFILE_NAME }`：零引用方的多余公开面，且让
  `profiles.ts` 的常量有了第二条 import 路径（Divergent Change 磁石）。
- **修复** 隔离测试里的 `path.startsWith(rootDir)` **假通过**：它会接受
  `<root>-evil/...` 这样的兄弟目录。改为 `relative()` + 检查是否以 `..` 开头。
- **`now: () => Date` 从「未付费的缝」变成「唯一可达的失败注入点」**：
  实测确认 `reset` 的 cleanup-first 语义会擦掉一切外部植入的 blocker，
  只有注入的 `now()` 能真正触达 catch 分支。用它补上了**回滚测试**。
- **降级** Windows junction 语义测试为注释：它从不调用被测模块、断言的是
  Node/Windows 语义、实现无法使其失败 —— 作为"别删这个判断"的绊线有价值，
  但**以测试形式存在会给后来者绿灯**，故改为注释。
- 移除与常量重复的**同义反复断言** `assert.equal(DESKTOP_SAFE_MODE_PROFILE_NAME, 'desktop-safe-mode')`。

### 6.6 本阶段未做（与设计的差异）


- `DESKTOP_SAFE_MODE_DEFAULTS` 仍未移植（理由见 3.2，等阶段 5 定设置模型）
- 未接入启动流程
- 未做 Safe Mode 的重启入口

