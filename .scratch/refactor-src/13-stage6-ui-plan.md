# 阶段 6 框架规划（修订版）— 恢复页 UI 全套对齐

> 用户已确认走**全套对齐**路线：React + Vite + Tailwind + @base-ui/react。
> 本文档先定框架，再实施。

## 一、先搞清事实：我们项目的框架现状（实测）

```
name:           deepseek-harness-desktop
type:           module（纯 ESM）
main:           dist/src/main.js
packageManager: pnpm@11.24.0
engines:        node 24.20.0

dependencies（仅 2 个）
  electron-updater ^6.8.9
  yaml             2.9.0

devDependencies（8 个）
  electron 44.1.1 / electron-builder 26.15.7
  typescript 7.0.2 / tsdown 0.22.2 / @electron/notarize
  @types/node
  react ^18.2.0 / @types/react ~18.3.1   ← 装了但**全仓零 import**
```

**UI 现状**：6 个**手写原生 HTML**（shell / settings / recovery / about /
shortcuts / startup），原生 JS + 手写 CSS，**零前端框架、零构建步骤**，直接拷贝进包。

**结论**：我们不是"用 React 但少几个组件"，而是**完全没有前端框架**。
阶段 6 会把启动器从"零框架"变成"需要维护前端工具链"——这是**有意的代价**，
换来的是与参考实现**同构**从而能做到视觉一致。

## 二、参考实现的技术栈（实测来源）

### 2.1 哪些是第三方 npm 包

查 `dsh-desktop/yarn.lock` 确认：

| 包 | 版本 | 来源 |
|---|---|---|
| `@base-ui/react` | 1.7.0 | **第三方**（lockfile: `@base-ui/react@npm:1.7.0`，依赖 `@babel/runtime`、`@floating-ui/react-dom`、`@base-ui/utils`） |
| `lucide-react` | 1.41.0 | **第三方**（peer: react ^16.5.1 \|\| …） |
| `class-variance-authority` | ^0.7.1 | 第三方 |
| `clsx` / `tailwind-merge` | ^2.1.1 / ^3.6.0 | 第三方 |
| `tailwindcss` / `@tailwindcss/vite` | ^4 | 第三方 |
| `react` / `react-dom` | 18.3.1 | 第三方 |
| `vite` / `@vitejs/plugin-react` | 8.2.1 / ^6 | 第三方 |

`dsh-desktop` **没有** `vendor/`、**没有** patches —— 没有魔改任何第三方包。

### 2.2 哪些是 dsh-desktop 自己写的

`src/native-ui/components/ui/` 的 **13 个文件**（alert / badge / button / card /
dialog / hover-card / input / label / radio-group / scroll-area / sonner /
switch / tabs）是 **dsh-desktop 手写的样式封装**（shadcn 模式）：

```tsx
// button.tsx 头部 —— 用第三方原语 + 自家 cva 变体
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.ts'
const buttonVariants = cva('inline-flex h-8 …', { variants: { variant: { … } } })
```

**所以要"对齐 UI"，第三方库和这套自写封装两边都要有。**

### 2.3 镜像可用性（已实测）

所有 9 个包在当前 registry（`https://registry.npmmirror.com/`）上均可获取，
且版本不低于参考实现：

```
vite 8.2.2 / @vitejs/plugin-react 6.1.1 / tailwindcss 4.3.3
@tailwindcss/vite 4.3.3 / @base-ui/react 1.8.0 / lucide-react 1.44.0
class-variance-authority 0.7.1 / clsx 2.1.1 / tailwind-merge 3.6.0
```

## 三、工程结构

```
src/recovery-ui/                    ← 新增：恢复页前端源码
  main.tsx                          挂载入口
  App.tsx                           页面骨架（对应参考 recovery/App.tsx）
  panels/
    QuickPanel.tsx  PluginsPanel.tsx
    RollbackPanel.tsx               ← checkpoint（后端阶段 3 已就绪）
    ProfilesPanel.tsx               ← 接已有 desktopProfiles 后端
    DiagnosticsPanel.tsx
  components/
    ui/                             ← 按需移植的 shadcn 封装
    NoticeSurface.tsx  ActionFooter.tsx
  lib/utils.ts                      cn() = clsx + tailwind-merge
  styles.css                        Tailwind 入口 + 主题变量
  recovery-api.ts                   类型化包装 preload 的 dshRecovery.*

vite.config.ts                      ← 新增
tsconfig.recovery-ui.json           ← 新增（JSX + DOM lib，与主 tsconfig 隔离）
```

**为什么源码不进 `assets/`**：`assets/` 是"原样拷贝的静态页"；这里要经 Vite 构建，
只有产物进包。源码与 `src/` 下其它 TS 同源但**独立构建**。

## 四、构建与打包接线

- Vite 输出到 `dist/recovery-ui/`（`base: './'` 以支持 `file://` 加载）
- `package.json`：
  - 新增 `build:recovery-ui` = `vite build`
  - **接进 `build:all`**（关键：`test` 依赖 `build:all`，漏了会在干净 clone 上失败——
    ticket 02 已踩过这个坑）
  - `extraResources` 增加 `dist/recovery-ui`
- 新增 `resolveRecoveryUiPath()`：dev 读 `dist/recovery-ui/index.html`，
  打包读 `process.resourcesPath/recovery-ui/index.html`

## 五、CSP（对齐参考实现）

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'none'; connect-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

三点说明：

- `connect-src 'none'` 意味着**页面内不能发网络请求**——我们走 IPC，
  `ipcRenderer.invoke` 不受该指令限制，因此可以照抄这条最严 CSP
- Tailwind 需要 `style-src 'unsafe-inline'`（参考实现也有）
- Vite 产出独立 JS/CSS 文件，满足 `script-src 'self'`

## 六、数据通道：保留我们的 IPC，不照搬 scheme

参考实现把状态 base64 编码进 URL query，每次操作 `window.location.assign(href(...))`
**整页跳转**（`App.tsx` 里全是 `<Action action="…">`）。

**我们已经是 IPC**（`recovery-preload.cts` 暴露 `dshRecovery.*`，8 个方法），
对 React 更合适：状态可直接调用、无需整页刷新。

**决策：保留 IPC 模型，不照搬 scheme + 整页跳转。** 这是有意的差异，
视觉与结构对齐，数据通道用我们的。

## 七、分步实施（每步可独立验证、可提交）

### 步骤 1：构建链打通（**不写业务 UI**）

- [ ] 装依赖
- [ ] `vite.config.ts` + `tsconfig.recovery-ui.json`
- [ ] `build:recovery-ui` 接进 `build:all`
- [ ] `extraResources` + `resolveRecoveryUiPath()` + preload
- [ ] **渲染一个最小页面**（标题 + 一个按钮 + 两个 IPC 调用）
- **验收**：`pnpm start` 与 `dist-local` **两条路径**都能看到最小页面，
  无 CSP 报错、无控制台错误

**先做这步的理由**：构建链是本次唯一的新基础设施，风险集中于此。
先证明它跑通，再写 UI，避免"UI 写完了才发现构建链有问题"。

### 步骤 2：UI 原语层

- [ ] `lib/utils.ts`（`cn`）
- [ ] 移植需要的 shadcn 组件（**按需，不求 13 个全搬**）：
      button / card / alert / tabs / badge / scroll-area
- [ ] `styles.css`：Tailwind + 主题变量，与 `DESKTOP_THEME_PALETTES` 对齐
- **验收**：能渲染出一页按钮/卡片/标签页，浅深色都正常

### 步骤 3：API 层 + checkpoint 后端接线

- [ ] `recovery-api.ts` 类型化包装现有 8 个方法
- [ ] 扩充 preload + 主进程 handler：checkpoint 列表 / 检查 / 恢复
      （复用阶段 3 的 `createDesktopProfileCheckpoint`）
- **验收**：开发者工具里逐个方法可调通

### 步骤 4：两阶段确认（后端先行）

- [ ] preview → `{ previewId, expiresAt }`，缓存 5 分钟
- [ ] execute → 校验存在 / 未过期 / 未消费，**先消费再执行**
- [ ] preview 数量上限
- [ ] 错误码 `preview-expired` / `invalid-target` / `operation-failed`
- **验收**：单测覆盖过期、重复消费、并发、上限

### 步骤 5：UI 重建

- [ ] `App.tsx`：Reason 卡片 + Tabs + ActionFooter
- [ ] 面板按依赖顺序：Quick → Plugins → Rollback → Profiles → Diagnostics
- **验收**：截图（`vision_html_screenshot`）；与参考的逐像素对比需你提供参考截图

### 步骤 6：接线与清理

- [ ] 新页面替换 `assets/recovery.html`
- [ ] 确认无引用后删除旧实现
- [ ] 文档 + ticket 收尾

## 八、范围边界（不做的部分）

参考页含**我们没有后端**的能力，**不做假 UI**，页面上如实标注或直接不显示：

| 功能 | 我们有吗 | 处理 |
|---|---|---|
| 插件卸载 / 恢复 / 保留隔离 | ✅ 有（8 个 IPC） | 做 |
| checkpoint 回滚 | ✅ 有（阶段 3） | 做 |
| **profile 列表 / 切换** | ✅ **有**（`desktopProfiles` 服务 + 设置插件已有 UI） | 做 |
| 诊断 / 启动日志 | ✅ 有 | 做 |
| 返回工作台 / 重启 / 退出 | ✅ 有 | 做 |
| Safe Mode 进入 | ⚠️ 部分（阶段 2 已做隔离环境，UI 未接） | 视步骤 5 进度 |
| 数据目录管理 | ❌ 无后端 | **不做** |
| 出厂重置 | ❌ 无后端 | **不做** |
| 打开配置文件编辑 | ❌ 无后端（只有恢复健康配置） | **不做** |

## 九、风险

1. **规模**：参考实现仅窗口 + 控制器就 1300+ 行，`App.tsx` 263 行密集 JSX。
   **必须分步提交、每步验证**，不要一次做完。
2. **视觉对齐验证手段有限**：我能渲染**自己的**页面截图，但与参考的逐像素对比
   **需要你提供参考截图**（我无法渲染参考的 React 构建产物）。
3. **依赖面扩大**：启动器从 2 个运行时依赖变成"启动器 + 一整套前端工具链"。
   上游（base-ui / tailwind）大版本升级需要跟。
4. **`react` 已在 devDeps 但零 import**：说明历史上有人尝试过。实施时应确认
   它的版本（^18.2.0）与我们要装的 `react-dom` 一致，避免版本漂移。
