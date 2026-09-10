# 06 — 抽 notifications 与 updater（含打破 tray 环）

**What to build:** 通知与更新器各自独立成模块，并打破它们与托盘之间的循环依赖。

**为什么两者必须同一个 ticket**：它们共享同一个活动通知集合（更新器要按 id 查/撤自己的通知），
分开做会留下半截状态，且中间态无法验证。

**为什么必须处理托盘环**：实测存在真实的双向依赖——

```
设置更新状态  ──调用──▶  刷新托盘菜单
刷新托盘菜单  ──读取──▶  更新状态（经托盘菜单项构造）
```

现在不成环，只因为两个函数同处一个文件、共享模块级变量。一旦拆成两个模块，直接 import
就会产生 ES 模块循环依赖。

**决策：用依赖注入打破**（显式传入回调），不用事件总线。理由：真正成环的边只有少数几条，
显式依赖足以打破；完整事件总线对这种规模是过度设计，且会让调用链难以追踪、引入新的静默
失败模式（事件名拼错或订阅时机不对都不会报错）。

**Blocked by:** 05 — 抽 DesktopWindowRegistry

**Status:** 代码完成，**待人工验证**

- [x] 通知模块独立：`notification-service.ts`（偏好、活动通知集合、未读数、系统通知、
      点击/回复处理、Windows toast 身份注册）
- [x] 更新器模块独立：`update-service.ts`（状态、偏好、检查/下载/安装、更新通知、
      renderer 快照）
- [x] **打破托盘环**：两条边都改为注入回调（见下）
- [x] 托盘模块独立：`tray-service.ts`（6 个外部依赖全部显式注入）
- [x] **依赖图检查：三个模块之间零 import**（实测确认，全部走注入）
- [x] `check:all` 通过、全量测试 **330 / 324 / 5**（与基线一致）
- [x] `dist-local` 出包成功；插件哈希 2/2，bridge 14/15（差异仍来自 ticket 02）
- [ ] **人工启动确认**：托盘菜单可打开、更新状态能反映到托盘项、通知能正常弹出

## 执行结果

### 环的两条边（实测确认，均改为注入）

```
updater → tray     setDesktopUpdateStatus 内调用 refreshTrayMenu
tray    → updater  handleTrayUpdateAction 内调用 check/download/install
notifications → tray   updateUnreadCompletionBadge 内调用 refreshTrayMenu
```

第三条（通知 → 托盘）是实施时才发现的：未读角标变化也要刷新托盘菜单，同样构成环。

全部在 `startApplication` 中**一处接线**，三个模块互相不 import：

| 模块 | 行数 |
|---|---|
| `notification-service.ts` | 267 |
| `update-service.ts` | 252 |
| `tray-service.ts` | 128 |

### 为什么托盘最后抽

派生的实测数据印证了 ticket 的排序理由：托盘依赖 **6 个外部函数**
（`showMainWindow`、`reloadDsh`、`requestQuit`、`checkForUpdates`、`downloadUpdate`、
`installUpdate`），其中 3 个来自更新器。所以它必须在另两个之后抽，否则依赖无处可指。

### 主入口变化

`main.ts` **2178 → 1755 行**（−423）。这是重构开始以来 main.ts 第一次显著变小——
ticket 04 净减 29 行、ticket 05 净增 45 行，本次是第一次真正见效。

### 实施过程中的两个自查错误

1. **`notificationCopy` 我凭印象重写而非照抄原文**，改了文案与逻辑（原文有
   `approval`/`question` 三种 kind、`“${title}”` 引号包裹等细节）。tsc 因字段名不存在而报错，
   才暴露出来。已改回逐字一致。
2. **`desktopUpdateSnapshot` 形状写错**（我写成了扁平结构，原文是嵌套 `status` +
   `packaged` + 条件 `lastCheckedAt`）。也是靠读原文修正。

两次都是「没读原实现就动笔」，属于我自己引入的风险。

