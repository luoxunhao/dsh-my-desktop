# 01 — 构建链接线（Vite + React + Tailwind 接入启动器）

**What to build:** 把 Vite + React + Tailwind 的构建链接进启动器，产出一个**最小可加载页面**，
证明 dev 与打包两条路径都能跑通。**不写任何业务 UI。**

**Blocked by:** 无（阶段 1–5 已完成，本 ticket 与其无依赖）

**Status:** ready-for-agent

## 为什么先做这一步

构建链是本阶段**唯一的新基础设施**，风险集中于此：

- 启动器目前是**零前端框架**（6 个手写原生 HTML、零构建步骤、直接拷进包），
  引入 Vite 是第一次
- `test` 脚本依赖 `build:all`，**漏接构建会让干净 clone 上的测试失败**
  （ticket 02 已踩过此坑：当时 `test` 漏了 `build:flat`）
- 现有测试基线是 **406 / 400 / 5**，构建链接错会污染它

先证明构建链能跑通，再写 UI，避免"UI 写完了才发现构建链有问题"。

## 实施依据（已实测）

**依赖可达性**（registry = `https://registry.npmmirror.com/`）：

```
vite 8.2.2 / @vitejs/plugin-react 6.1.1 / tailwindcss 4.3.3
@tailwindcss/vite 4.3.3 / @base-ui/react 1.8.0 / lucide-react 1.44.0
class-variance-authority 0.7.1 / clsx 2.1.1 / tailwind-merge 3.6.0
```

均不低于参考实现（`dsh-desktop` 用 vite 8.2.1 / base-ui 1.7.0 / lucide 1.41.0）。

**版本陷阱（必须处理）**：启动器 `devDependencies` 里**已有** `react ^18.2.0`
与 `@types/react ~18.3.1`，但**全仓零 import**。新装 `react-dom` 时**必须锁定同一
18.x 次版本**，避免一次装出两个 React 版本。

## 交付物

- [ ] 安装依赖（含上面的版本陷阱处理）
- [ ] Vite 配置：`base: './'`（支持 `file://` 加载）、React 插件、Tailwind 插件
- [ ] 独立的 tsconfig 覆盖前端源码（JSX + DOM lib，与主 tsconfig 隔离）
- [ ] `package.json` 新增 `build:recovery-ui`，并**接进 `build:all`**
- [ ] 打包资源清单（`build.extraResources`）增加构建产物目录
- [ ] 新增构建产物路径解析函数：dev 读构建目录、打包读 `process.resourcesPath`
- [ ] **最小页面**：标题 + 一个按钮 + 两个 IPC 调用（证明 IPC 通道可用）
- [ ] 页面 CSP 对齐参考实现（见下）

## CSP（对齐参考实现）

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'none'; connect-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

- `connect-src 'none'` 表示**页面不能发网络请求**。我们走 IPC，
  `ipcRenderer.invoke` 不受该指令限制，因此可以照抄这条最严 CSP
- Tailwind 需要 `style-src 'unsafe-inline'`（参考实现也有）
- Vite 产出独立 JS/CSS，满足 `script-src 'self'`

## 验收（两条路径都要实测）

- [ ] `pnpm start`（dev）能看到最小页面
- [ ] `dist-local` 出包后运行安装版能看到最小页面
- [ ] 无 CSP 报错、无控制台错误
- [ ] `check:all` 通过
- [ ] **全量测试仍为 406 / 400 / 5**（不得因构建链接入而变差）
- [ ] `dist-local` 出包成功

## 不做

- 不写任何业务面板
- 不移植 UI 组件
- 不接 checkpoint / profile 后端
- 不替换 `assets/recovery.html`
