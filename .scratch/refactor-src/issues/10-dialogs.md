# 10 — 抽出辅助对话框窗口（设置 / 快捷键 / 关于）

**What to build:** 三个辅助窗口的创建与显示独立成模块。

实测：`showDesktopSettingsWindow` / `showShortcutsWindow` / `showAboutWindow`，
共 **89 行，零 state 依赖**（已实测确认不引用任何 store 分组）。

**这是全仓最干净的分组**：无状态依赖、无对外调用边。适合作为「窗口注册表之后」
的第二个窗口类抽取，验证注册表提供的缝是否真的够用。

**Blocked by:** 05 — 抽 DesktopWindowRegistry

**Status:** ready-for-agent

**Status:** 代码完成，**待人工验证**

- [x] 抽出 `src/desktop/dialog-service.ts`，承载三个辅助窗口的创建与显示
- [x] 依赖 `mainWindow`/`colorScheme` 等**访问器**，不 import store 整体
- [x] 三个窗口的 preload、尺寸、居中（parent）、关闭行为原样保留
- [x] 「已打开时不重复创建、改为聚焦」的行为保留
- [x] `check:all` 通过、全量测试 **335 / 329 / 5**（与基线一致）
- [x] `dist-local` 出包成功
- [ ] **人工启动确认**：设置 / 快捷键 / 关于三个入口都能打开，内容正常

**备注**：本 ticket 为 ticket 05 的窗口注册表提供第一个真实消费者。若发现注册表暴露的
接口不够用（例如需要新的访问器），**如实报告并说明缺什么**——那说明 ticket 05 的缝划得
不够，属于有价值的反馈，不要绕开注册表去直接读 `state.windows.*`。

## 执行结果

### ticket 前提有误（实测纠正）

ticket 写「**零 state 依赖**」。实测**不成立**——三个函数都引用两个 store 分组：

| 函数 | 引用的 store 字段 |
|---|---|
| `showDesktopSettingsWindow` | `shell.colorScheme`×2、`windows.mainWindow`×1、`windows.settingsWindow`×8 |
| `showShortcutsWindow` | `shell.colorScheme`×2、`windows.mainWindow`×1、`windows.shortcutsWindow`×7 |
| `showAboutWindow` | `shell.colorScheme`×2、`windows.aboutWindow`×7、`windows.mainWindow`×1 |

不过性质与 ticket 的判断一致：依赖的只是**窗口句柄**（自己那个 + 主窗口用于居中）
与**主题色**，都通过访问器注入，没有 import `DesktopState`。

### 顺带消掉的 Duplicated Code

三个函数原本是同一套模板的三份拷贝：复用或创建 → 配 parent/preload/背景色 →
去菜单 → 防闪烁 → 存句柄并在 closed 时清空 → 装快捷键 → 加载资源。

抽出 `openDialogWindow(slot, options)` 后模板只有一份，调用方只提供**真正不同**的部分
（尺寸、模态、边框、标题、资源、背景色）；设置窗口额外通过 `onLoaded` 钩子补发
section 与更新快照，而不是走特殊分支。这是 ticket 没提到的收益。

### 处理过程中的三个自纠

1. `SHELL_IPC` 与 `DESKTOP_APP_NAME` 漏了 import（tsc 抓出）
2. About 窗口的 `icon` 选项一度漏掉（读原实现时发现并补回）
3. `DesktopSettingsSection` 类型 main.ts 里已有本地声明，与新 import 冲突

### 实测启动验证

DSH 服务监听 `127.0.0.1:10928`，渲染进程已建立 `Established` 连接；启动诊断
`stage: "healthy"`；首页 401（token 门禁）、桌面设置插件 API 200；无 `startup-error.log`。

主入口 1602 → **1487 行**。
