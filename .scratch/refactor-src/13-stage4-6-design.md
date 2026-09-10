# 恢复模式对齐 — 阶段 4~6 设计

> 阶段 4（重启改整应用 + 确认框）、阶段 5（启动消费标记、不启 Host、IPC 数据通道）、
> 阶段 6（重建恢复页 UI）。三者强耦合，合并成一份设计。

## 阶段 4 — 重启改为重启整个应用

### 4.1 现状 vs 目标

| | 现状 | 目标 |
|---|---|---|
| 重启范围 | 只重启 DSH 子进程 | **整个 Electron 应用** |
| 状态载体 | profile 内落盘文件 | **进程标记**（阶段 1 已就绪） |
| 确认 | 无 | **原生确认框** |

### 4.2 目标流程（对齐参考实现 `electron-runtime.ts:452-497`）

```
requestRecoveryRestart()
  → 若 quitting → return
  → 若已有 in-flight restartRequest → await 它（防连点）
  → 弹原生确认框（type:'question'，按钮 [确认, 取消]，defaultId:1，cancelId:1，noLink:true）
  → 仅当 response === 0 继续
  → app.relaunch({ args: desktopRecoveryRelaunchArguments() })
  → 有序退出（shutdownDesktop(() => app.exit(0))）
```

### 4.3 要点

- **幂等**：`restartRequested` 标志 + in-flight promise 去重。参考实现用后者；
  我们两者都要，因为我们的 `shutdownDesktop` 是异步的
- **默认选中「取消」**（`defaultId: 1`）：重启会中断当前工作，默认应是安全选项
- **必须先 relaunch 再 exit**：顺序反了会导致应用退出但没重启
- `desktopRecoveryRelaunchArguments()` 已在阶段 1 实现，直接可用

### 4.4 不做

- **不实现 Safe Mode 的重启入口**（本阶段只做恢复模式；Safe Mode 需要
  `ensureDesktopSafeModeEnvironment` 在启动前生效，属阶段 5 的启动流程改动）
- 不改动正常重启（`restartDesktop`）的行为——它已工作，且不在本 ticket 范围

---

## 阶段 5 — 启动时消费标记

### 5.1 现状

`startApplication()` 无条件启动 DSH 子进程并加载 workbench。

### 5.2 目标

```
读取 desktopRecoveryModeRequested()
  ├─ false → 现有流程不变
  └─ true  → 跳过 Profile 兼容性准入
             不启动 DSH 子进程
             直接开恢复窗口
```

### 5.3 ⚠️ 最大改动：恢复页的数据来源换成 IPC

我们现在的 `recovery.html` 通过 **DSH 提供的 HTTP 接口**读状态。
不启 Host 后这些接口不存在。

**这是本阶段的核心工作**：为恢复页提供一条**不依赖 DSH** 的数据通道。

两个选项（实现时择一，优先 A）：

- **A（推荐）**：恢复窗口用**独立 preload**（`recovery-preload.cjs`，**已存在**）
  暴露一组 `ipcRenderer.invoke` 方法，主进程直接返回状态
- **B**：主进程临时起一个极小的回环 HTTP 服务

选 A：不需要开端口、不引入网络面、与现有 preload 机制一致（`resolvePreload` 已支持
`recovery-preload.cjs`）。

### 5.4 需要在恢复模式下仍可用的能力

阶段 6 的 UI 需要这些数据（每项都要有对应的 IPC handler）：

- [ ] 恢复状态（是否在恢复模式、失败原因、时间）
- [ ] 已加载/失败的插件清单
- [ ] checkpoint 槽位列表（slotId / 是否有快照 / capturedAt / appVersion / 文件数 / 总字节）
- [ ] checkpoint 差异检查（`inspectSlot` → changedFiles）
- [ ] 恢复某个 checkpoint（`restoreSlot`）
- [ ] 卸载某个插件
- [ ] 退出恢复模式 / 重启

### 5.5 启动顺序约束

`app.setPath('userData')` 必须在 `app.whenReady()` **之前**才有意义。
但恢复模式的判定也需要 `userData`（Safe Mode 隔离时）。

**结论**：标记的读取要提到**模块顶层**（`main.ts` 顶部，早于 `whenReady`），
与参考实现一致（它也在 `main.ts:406` 靠前读）。

### 5.6 Safe Mode 与本阶段的交集

若本阶段顺带支持 Safe Mode 启动：

- `safeModeRequested` 时 `ensureDesktopSafeModeEnvironment()`
- **否则必须 `delete process.env.DSH_HOME`（若指向隔离目录）并清理上次遗留**

第二条是防泄漏的关键（见阶段 2 设计 2.x）。

**决策**：阶段 5 **只做恢复模式**。Safe Mode 的启动接入单独一轮——因为它引入
userData 隔离，会与阶段 5 的 userData 判定互相影响，混做容易两头不清。

---

## 阶段 6 — 重建恢复页 UI

### 6.1 参考实现的 UI 结构

```
recovery.html          10 行（严格 CSP + #root + module script）
recovery/App.tsx      242 行
recovery/main.tsx       7 行
shared/RecoveryWindowPrimitives.tsx  57 行
shared/DesktopFrame.tsx              14 行
shared/theme.css                     99 行
```

### 6.2 CSP（必须对齐，参考实现很严）

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'none';
connect-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

`connect-src 'none'` 意味着**页面内不能发任何网络请求**——这正是必须走 IPC 的原因，
也与阶段 5 的选型 A 相互印证。

### 6.3 引入 React + Vite 到启动器（新构建链）

启动器目前**没有** React/Vite 构建链（插件有，启动器没有）。需要：

- [ ] 新增 `src/recovery-ui/`（TSX 源码）
- [ ] 新增 Vite 配置，产出到 `dist/recovery-ui/`
- [ ] 接进 `build:all`（**注意**：`test` 依赖 `build:all`，所以 CI 会一起构建）
- [ ] 更新 `package.json` 的 `extraResources`，把产物放进安装包
- [ ] 更新 `resolveShellAsset` 或新增解析器，指向新产物
- [ ] 更新 `test/prepare-runtime.test.ts` 之类的构建链断言（若有）

### 6.4 两阶段确认（preview → execute）

参考实现的保护（`startup-recovery-controller.ts`）：

- `previewId` 形如 `uninstall_<43>` / `restore_<43>`
- **5 分钟 TTL** + **一次性消费**
- `MAX_PREVIEWS = 256`
- `generation` 校验：generation 变了就拒绝（防旧窗口操作新一代）
- 错误码：`generation-changed` / `immutable-target` / `invalid-target` /
  `operation-failed` / `operation-in-progress` / `preview-expired` / `state-unavailable`
- `maskSecrets` 脱敏错误详情，上限 24000 字符

**我们要实现的子集**（不做 `maskSecrets`，我们没有 secret 注入路径）：

- [ ] preview 返回 `previewId` + `expiresAt`，缓存 5 分钟
- [ ] execute 校验 `previewId` 存在、未过期、未消费，然后**先消费再执行**
- [ ] preview 数量上限（防内存膨胀）
- [ ] 至少实现 `preview-expired` / `invalid-target` / `operation-failed` 三个错误码

### 6.5 视觉对齐

需要拿到参考实现在**深/浅两色**下的实际渲染做对照。`theme.css` 99 行是共享主题，
`App.tsx` 242 行是布局与交互。

**实现时需**：截图对比（`vision_html_screenshot` 渲染本地 HTML + `vision_pixel_diff`）。
参考实现是 React，我们无法直接渲染它的构建产物，因此以**读源码 + 复刻视觉**为准，
必要时请用户提供截图。

---

## 阶段依赖与顺序

```
阶段1 ✅ 进程标记
   ↓
阶段2 Safe Mode 隔离环境（独立可测，无调用方）
   ↓
阶段3 checkpoint 存储（独立可测，无调用方）
   ↓
阶段4 重启改整应用 + 确认框  ←── 需要阶段1
   ↓
阶段5 启动消费标记 + IPC 数据通道  ←── 需要阶段4
   ↓
阶段6 恢复页 UI（React + 两阶段确认）  ←── 需要阶段3 + 阶段5
   ↓
阶段7 ticket 13 原定重构（边界此时才确定）
```

**阶段 2 / 3 可以并行**（互不依赖，都是纯模块 + 单测）。
**阶段 5 是风险最高的一步**（换数据通道 + 改启动流程），建议单独一轮、单独验证。
