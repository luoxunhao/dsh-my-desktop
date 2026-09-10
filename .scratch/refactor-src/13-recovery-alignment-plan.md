# 13 修订方案 — 按 dsh-desktop 的做法重做恢复模式

> 用户要求：重启到恢复模式按 `E:/project/dsh/dsh-desktop/` 的实现方式来，**包括界面样式**。
> 本文记录调研结论与实施方案。原 ticket 13（只把 260 行移出 main.ts）范围已被取代。

## 一、参考实现的核心机制

### 1.1 一次性进程标记（`relaunch-arguments.ts`，30 行）

```ts
const DESKTOP_RECOVERY_MODE_ARGUMENT = '--dsh-desktop-recovery'

desktopDefaultRelaunchArguments(argv)   // 重建命令行，滤掉两个一次性标记
desktopRecoveryRelaunchArguments(argv)  // default + recovery 标记
desktopRecoveryModeRequested(argv)      // 精确匹配 argv.slice(1).includes(...)
```

**关键性质**：

- 恢复模式是**新一代进程**的状态，不是当前进程内的标志位
- 标记在 relaunch 时**加上**，新进程启动时**消费**
- `desktopDefaultRelaunchArguments` 会**滤掉**它 → 下次正常重启不会再次进入恢复
- 检测用精确匹配，**不接受前缀变体**（避免 `--dsh-desktop-recovery-x` 误命中）

### 1.2 重启流程（`electron-runtime.ts:452-497`）

```
requestRecoveryRestart()
  → 若 quitting 则 return
  → 若已有 restartRequest 则 await 它（去重，防连点）
  → confirmAndRestart('recovery')
      → desktopRestartConfirmationCopy(locale, 'recovery')
      → dialog.showMessageBox({ type:'question', buttons:[确认,取消],
                                defaultId:1, cancelId:1, noLink:true })
      → 仅当 response === 0 才继续
      → restart('recovery')
  → finally 清空 restartRequest
```

### 1.3 relaunch 与退出（`main.ts:504-521`）

```ts
runtime = new ElectronDesktopRuntime(async target => {
  if (shutdown === undefined) throw ...
  if (restartRequested) return                       // 幂等：只重启一次
  if (target === 'safe-mode') prepareSafeMode()
  restartRequested = true
  nativeExit.requestRelaunch(
    target === 'recovery' ? desktopRecoveryRelaunchArguments() : desktopDefaultRelaunchArguments()
  )
  await shutdown.request(0)                          // 有序退出当前进程
})
```

### 1.4 新进程启动时消费（`main.ts:406` / `821` / `1051`）

```ts
const recoveryModeRequested = desktopRecoveryModeRequested()
...
if (!recoveryModeRequested) { /* Profile 兼容性检查与准入流程 */ }
...
if (recoveryModeRequested) { /* 直接开恢复窗口，不启动 Host */ }
```

**这是与我们的根本差异**：dsh-desktop 在恢复模式下**完全跳过 Host 启动**，恢复窗口先于
Host 存在。我们目前是「进程内重启 DSH 子进程」，Host 始终在跑。

### 1.5 恢复窗口 UI（native-ui/）

```
recovery.html          10 行（CSP + <div id=root> + module script）
recovery/App.tsx      242 行
recovery/main.tsx       7 行
shared/RecoveryWindowPrimitives.tsx  57 行
shared/DesktopFrame.tsx              14 行
shared/theme.css                     99 行
```

- CSP 严格：`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';`
  `img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`
- 窗口实现 `startup-recovery-window.ts` **851 行**，控制器 `startup-recovery-controller.ts` **483 行**
- 控制器含我们**完全没有**的能力：checkpoint 快照列表/恢复、preview→execute 两阶段确认
  （previewId + 5 分钟 TTL + 一次性消费 + MAX_PREVIEWS 上限）、generation 校验
  （防旧窗口操作新一代）、bundle 卸载授权、`maskSecrets` 脱敏错误详情

## 二、我们现状 vs 目标

| 维度 | 我们（现状） | dsh-desktop（目标） |
|---|---|---|
| 恢复状态载体 | profile 目录内的文件 | **进程启动参数** |
| 重启范围 | 只重启 DSH 子进程 | **整个 Electron 应用** |
| 进入前确认 | 无 | **原生确认框**（默认选中取消） |
| 跳过 Host | 否 | **是** |
| 恢复页 | `recovery.html` 18KB 单文件 | React + Vite 构建 |
| 控制器 | `recovery-mode.ts` 291 行 | `startup-recovery-controller.ts` 483 行 |
| 窗口 | inline in main.ts | `startup-recovery-window.ts` 851 行 |

## 三、实施方案

### 阶段 1 — 进程标记机制（新增，独立可验证）

新增 `src/recovery/relaunch-arguments.ts`，逐字对齐参考实现：

- 同名常量与函数（`DESKTOP_RECOVERY_MODE_ARGUMENT` 等）
- 精确匹配检测，滤掉一次性标记
- 单测覆盖：重建命令行、加标记、检测、滤除

### 阶段 2 — 重启改为重启整个应用

- `restartIntoRecoveryFromShell` 改为：确认框 → `app.relaunch({ args: recoveryArgs })` → `app.exit(0)`
- 加原生确认框（`type:'question'`、默认选中取消、`noLink:true`）
- 幂等：`restartRequested` 标志，防连点重复重启

### 阶段 3 — 启动时消费标记

- `main.ts` 启动早期读 `desktopRecoveryModeRequested()`
- 为真时：跳过 Profile 兼容性准入、直接开恢复窗口
- **注意**：我们需要决定恢复模式下 DSH 子进程是否启动。dsh-desktop 是不启动
  （恢复窗口是 Host 之前的权威）；我们若照做，恢复页就不能再依赖 DSH 提供的接口，
  必须走 Electron 主进程 IPC —— 这是本阶段最大的改动。

### 阶段 4 — 重建恢复页 UI

- 引入 React + Vite 构建链（启动器目前**没有**）
- 移植 `App.tsx` / `RecoveryWindowPrimitives.tsx` / `theme.css`
- 对齐 CSP、窗口尺寸、关闭行为

### 阶段 5 — ticket 13 原定的重构

- 抽出恢复流程为独立服务（原 ticket 13 目标），此时边界已由阶段 1~4 确定

## 四、风险与待决

1. **重启整应用会中断当前会话**：dsh-desktop 用确认框缓解。需确认用户可接受。
2. **恢复模式下不启动 Host** 是最大改动：我们现有 `recovery.html` 通过 HTTP 接口
   读状态（`recoveryPageStatus` → `/api/dsh-my-settings` 风格）。若不启动 Host，
   这些接口不存在，必须改为 Electron IPC 提供同一份数据。
3. **引入 React + Vite** 到启动器：需要新的构建步骤与依赖，且要接进 `build:all`
   与 electron-builder 的资源清单。
4. **安全模型**：dsh-desktop 的恢复页 CSP 极严（`connect-src 'none'`、`img-src 'none'`），
   我们需对齐。

## 五、与 ticket 08 的关系

原 ticket 08（文档 + 发版 0.1.4）blocked by 13。本方案把 13 从「重构」升级为
「重构 + 行为变更 + 新 UI」，因此 **0.1.4 的发布范围也应相应调整**（至少是
minor 版本，不是 patch）。
