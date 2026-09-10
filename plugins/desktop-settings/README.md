# dsh-my-desktop-setting

DSH My Desktop 的**定制**「桌面设置」插件（host+client）。注册进官方 Settings 壳的
`settings.section`，提供 Profile 管理、插件市场选择、AA 开关、外观/材质、浏览器/LAN 访问、
通知等设置区块。

本插件是 DSH My Desktop 的一部分，源码位于本仓库 `plugins/desktop-settings/`，
**随 desktop 一起构建、一起发布，不单独发 npm**。

## 特性与边界

- client 半边在官方 Settings 壳渲染一个"桌面设置"页（settings.section slot，id `desktop-settings`）。
- host 半边在 DSH server 进程运行：对可自洽的操作（插件市场选择、AA/通知偏好等）真实现持久化，
  对只属于 Electron 桌面壳的能力（重启、切换 profile、开终端、DevTools、诊断导出、LAN/材质等）做**能力探测**，
  缺失时明确返回"宿主不支持"让 UI 降级，不假装成功。
- 端点基路径与 DTO 见 `PLAN.md`；两端由 `src/client/desktop-settings-api.ts` 与 host 侧共同保证。

## 构建

在本仓库**根目录**构建（本目录是 pnpm workspace 成员，不要在子目录单独 install）：

```bash
pnpm install              # 根目录；官方 client 类型来自 plugins/desktop-settings/vendor/0.1.2-rc.1 tgz（与 dsh 0.1.2-rc.1 对齐）
pnpm run build:plugin     # tsdown 出 lib/index.js + lib/client.js，tsc 双 program 出 lib/types
pnpm run check:plugin     # 双 program noEmit
```

`lib/client.js` 是标准 `window.__ModuleLoader__.load({ id, factory })` 浏览器 bundle。

## 装配（随 dsh-my-desktop 发布）

打包时 `scripts/prepare-runtime.ts` 的 `stageDesktopSettingsPlugin()` 把 `lib/` 拷到
`dist/desktop-settings-plugin`，再由根 `package.json` 的 `extraResources` 落到安装包的
`resources/dsh-my-desktop-setting/`。运行时由 `src/desktop-settings-plugin.ts` 物化到
userData 目录并生成 `--patch` overlay 注入 DSH。


## 目录

- `src/index.ts` — host 入口（webServer 端点 + 能力探测）。
- `src/host-*.ts` / 子模块 — host 自洽操作与能力代理。
- `src/client/` — 设置页 UI、api、locale(zh/en)、styles 与 settings.section 注册。
