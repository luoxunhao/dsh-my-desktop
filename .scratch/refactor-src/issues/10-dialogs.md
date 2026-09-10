# 10 — 抽出辅助对话框窗口（设置 / 快捷键 / 关于）

**What to build:** 三个辅助窗口的创建与显示独立成模块。

实测：`showDesktopSettingsWindow` / `showShortcutsWindow` / `showAboutWindow`，
共 **89 行，零 state 依赖**（已实测确认不引用任何 store 分组）。

**这是全仓最干净的分组**：无状态依赖、无对外调用边。适合作为「窗口注册表之后」
的第二个窗口类抽取，验证注册表提供的缝是否真的够用。

**Blocked by:** 05 — 抽 DesktopWindowRegistry

**Status:** ready-for-agent

- [ ] 抽出对话框模块，承载三个辅助窗口的创建与显示
- [ ] 依赖 `DesktopWindowRegistry`（窗口句柄访问器）与主题/语言，**不直接读 store**
- [ ] 三个窗口的 preload、尺寸、位置（跟随主窗口居中）、关闭行为原样保留
- [ ] 「设置窗口已打开时不重复创建、改为聚焦」的行为保留
- [ ] `check:all` 通过、全量测试不新增失败
- [ ] `dist-local` 出包成功
- [ ] **人工启动确认**：顶栏的设置 / 快捷键 / 关于三个入口都能打开对应窗口，内容正常

**备注**：本 ticket 为 ticket 05 的窗口注册表提供第一个真实消费者。若发现注册表暴露的
接口不够用（例如需要新的访问器），**如实报告并说明缺什么**——那说明 ticket 05 的缝划得
不够，属于有价值的反馈，不要绕开注册表去直接读 `state.windows.*`。
