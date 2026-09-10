# dsh-my-desktop-setting — DSH My Desktop 的定制「桌面设置」插件

> **现状（已迁移）**：本插件源码现在位于 dsh-my-desktop 仓库内 `plugins/dsh-my-desktop-settings/`，
> 是 pnpm workspace 成员，随 desktop 一起构建、一起发布，**不单独发 npm**。
> 下文「独立仓库 / 宿主无关 / BUNDLED_PLUGINS 预装」等表述是迁移前的历史规划，
> 实际落地路线已改为「随包 `--patch` 注入」；目录布局已按新位置更新。
>
> dsh-desktop 仅是**参考/知识库**（界面长什么样、整页分几块、走哪些契约），**不是依赖，也不并入**。
> 目标运行时基线 = dsh-my-desktop 随包的官方 `@deepseek-ai/dsh@0.1.2-rc.1`（实测其 node_modules 内含
> `dsh-client-ui-settings@0.1.2-rc.1`、`dsh-client-locale@0.1.2-rc.1`、`dsh-client-ui-renderer@0.1.2-rc.1`、`cordis@4.0.2`）。

---

## 一、范围（参考 dsh-desktop 的 DesktopSettingsSection 整页）

| 区块 | 内容 | 在本插件里 |
|---|---|---|
| Profile | 列/选/建/删 web profile | host 自洽：读写 profile 目录/清单，选中态持久化 |
| 插件市场 | disabled / community-market / dsh-market | host 自洽：持久化市场选择 provider 状态 |
| AA | Agents-Anywhere 开关 | host 自洽：持久化开关；宿主未装对应 bundle 时提示 |
| 外观/材质 | compatibility/extended/advanced + 窗口材质 | **宿主专属**：仅通过设置命名空间回写，缺失时只读 |
| 浏览器/LAN | openBrowser / LAN / URLs | **宿主专属**：能力探测，缺失时降级隐藏 |
| 通知 | enabled + 4 事件开关 | host 自洽：写 `dsh-desktop-notifications` 命名空间偏好 |

原则：**client 半边完整复刻 UI 与交互**；**host 半边对纯文件/纯偏好操作自洽实现**，对只有 Electron 宿主才有的能力（重启、终端、DevTools、诊断导出、窗口材质、LAN HTTPS、原生通知）通过能力探测降级——缺失时该区块显示为"当前宿主未提供/只读"，不假装可用。

## 二、运行面与构建

- **运行面**：有 Web 设置页 → host + client。
- 官方模板/工具：参考 deepseek-harness `packages/client/ui-message-feedback` + `packages/client/tsdown.client.ts` 的 `clientBundle(id, …)` 封装产出 `window.__ModuleLoader__.load({ id, factory })`；双 tsc program（host `tsconfig.json` + client `tsconfig.client.json`）。
- 关键 import（与官方契约一致，纯 type 会被擦除，运行时可交给运行时提供）：
  - `import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'`
  - `import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'`
  - `import type {} from '@deepseek-ai/dsh-client-ui-settings/client'`（拉入 `settings.section` 的 SlotMap merge）
- 构建期依赖官方包（peer/dev）：cordis、dsh-client-ui-settings、dsh-client-ui-slots、dsh-client-locale、react。编译期类型来源用官方 harness（克隆 deepseek-harness 或同版本 vendor tgz），**不依赖 dsh-desktop monorepo**。

## 三、目录布局（迁移后）

```
dsh-my-desktop/
  plugins/dsh-my-desktop-settings/     # ← 本插件（pnpm workspace 成员）
    package.json          # host+client 双面、dsh.client.platform=web、dsh.bundle.patch
    tsconfig.json         # host program（src/*.ts）
    tsconfig.client.json  # client program（src/client/**）
    tsdown.config.ts      # 官方 clientBundle 封装（或等价）
    cordis.patch.yml      # 顶层数组 insert
    vendor/<dsh-ver>/     # 对齐官方 client 类型的 tgz
    src/index.ts          # host 入口（apply / name / inject）
    src/…                 # host：profile / market / 偏好 / 能力探测
    src/client/index.ts   # client 入口（inject + apply）
    src/client/desktop-settings*.ts(x)  # 页面、api、locales、styles（复刻）
    lib/                  # 构建产物（gitignore）
  scripts/prepare-runtime.ts    # stageDesktopSettingsPlugin：装配 lib/ → dist/desktop-settings-plugin
  src/desktop-settings-plugin.ts # 物化到 userData 并生成 --patch overlay
```

## 四、落地顺序
1. 工程骨架（package.json / tsconfig 双 program / tsdown / cordis.patch / git）。
2. host 面。
3. client 面（settings.section 注册 + 整页 + locale zh/en + styles）。
4. 类型检查 + tsdown 出 `lib/client.js`（验证 `__ModuleLoader__` 产物与纯值门）。

---

## 五、Host 面实现记档（已完成）

> 编写时间：Host 面源码阶段。此节由完成 host 面的 agent 追加，作为 host/client 对齐的契约与降级依据。
> **重要**：写本节时 `src/client/` 尚未由另一 agent 生成，因此「端点基路径与 wire 形状」以下述为准，client 的 `desktop-settings-api.ts` 必须逐字节对齐本节，否则 host/client 不一致。

### 5.1 创建的文件（全部在 `src/`，tsconfig include `src/*.ts` 顶层）

| 文件 | 职责 |
|---|---|
| `src/index.ts` | Host 入口：`name`/`inject`/`apply`。inject=`['webServer']`；探可选宿主服务；建 store+controller；`ctx.effect` 注册全部路由。 |
| `src/contract.ts` | 端点路径基 `/api/dsh-my-settings` + `settingsPaths` 表 + 全部 wire DTO（`DesktopSettingsView`/`DesktopRestartAcceptance`/`SettingsCapabilityView`/request/error 形状）+ capability token 枚举。 |
| `src/host-capability.ts` | 能力探测（`DSH_DESKTOP_HOST`、`ctx.desktopProfiles`/`desktopPnpm`/`desktopRuntime`）+ `HostCapability` + 能力清单生成。 |
| `src/state-store.ts` | 插件自有的 versioned JSON 状态文件（显式路径，绝不 `process.cwd()`）。只依赖 `node:*`。 |
| `src/host-controller.ts` | 读投影 + 写持久化 + Host-专属动作的显式能力结果（never fake）。 |
| `src/http-handlers.ts` | 同源守卫 + method/body 校验 + 能力门控（Host-专属不支持返回 501）。 |

不新增 package.json 未声明的运行时依赖；`@deepseek-ai/cordis` 仅 `import type`；`@deepseek-ai/dsh-host-webserver`/`@deepseek-ai/dsh-settings`/`@deepseek-ai/schemastery` 一律不 import，全部 `ctx` 鸭子类型 + 结构接口，避免依赖无法解析。

### 5.2 采用的端点基路径

**采用 `/api/dsh-my-settings`**，理由：
- 本插件预装进 dsh-my-desktop 的 `web` profile，与桌面桥（`dsh-plugin-desktop` 的 `/api/desktop/*`）同源共存，必须避免冲突。
- 写本节时 client 尚未生成，故由 host 定义权威基路径，client agent 按此实现 `desktop-settings-api.ts`（不要改成 `/api/desktop/...`）。
- 所有路径字符串集中在一处 `src/contract.ts` 的 `settingsPaths`，client 可 `import` 该常量（纯值）保持一致，或复刻为同值字面量。

### 5.3 端点表

| method+path | 能力来源 | 成功返回 | 能力缺失行为 |
|---|---|---|---|
| `GET /api/dsh-my-settings/state` | 自洽（读） | `DesktopSettingsView`（含 `host`/`market`/`aa`/`notifications`/`appearance`/`capabilities`） | —（只读恒可用） |
| `POST /api/dsh-my-settings/market/select` | 自洽（持久化偏好） | `DesktopRestartAcceptance` | 无显式状态目录 → 501 `persist.unavailable` |
| `POST /api/dsh-my-settings/aa/select` | 自洽（持久化偏好） | `DesktopRestartAcceptance` | 同上 |
| `POST /api/dsh-my-settings/notifications/update` | 自洽（持久化偏好） | `{accepted:true}` | 同上 |
| `POST /api/dsh-my-settings/appearance/update` | 自洽（持久化偏好）；是否生效=宿主 | `{accepted:true}`；`nativeCapable=false` 除非 native host | 持久化不可用 → 501；native 由 `capabilities` 报告 |
| `POST /api/dsh-my-settings/profile/switch` | 宿主 | — | 501 `host.unsupported/offline`，`capability:false` |
| `POST /api/dsh-my-settings/restart` | 宿主 | `{accepted:true}`（仅当可转发） | 501 + `capability:false` |
| `POST /api/dsh-my-settings/terminal/open` | 宿主 | `{accepted:true}` | 501 + `capability:false` |
| `POST /api/dsh-my-settings/devtools/toggle` | 宿主 | `{accepted:true}` | 501 + `capability:false` |
| `POST /api/dsh-my-settings/diagnostics/export` | 宿主 | `{accepted:true}` | 501 + `capability:false` |

> 能力清单里：`profile.discover`、`market.preference`、`aa.preference`、`notifications.preference`、`appearance.preference` = 自洽；`host.profile-switch/restart/open-terminal/devtools/diagnostics-export/web-and-material` = 宿主专属，`supported` 精确反映是否有可转发服务。

### 5.4 关键降级点与理由

1. **host 专属动作统一走能力门控，返回 501 + 稳定 code（`host.unsupported` / `host.offline`）+ `capability` token**，让 client UI 据此隐藏/只读/禁用，绝不假装成功、绝不抛未捕获异常（`http-handlers.handleHostAction`）。
2. **dsh-my-desktop 自身不向 web profile 暴露 restart/terminal/devtools/diagnostics 的 ctx 服务**（它只提供 `desktopProfiles`/`desktopPnpm`，且仅在 `DSH_DESKTOP_HOST=1` 时）。因此在这些 target 上，host 专属端点均为 501；只有当未来宿主把 `desktopRuntime`/`desktopSettingsController`（dsh-desktop 形态）挂上 ctx 时才支持——`index.probeLauncherPorts` 会鸭子类型发现这些方法并接线。
3. **profile 切换**：dsh-my-desktop 的 `desktopProfiles.select` 是单 profile 的 no-op（launcher 决定 profile）。本插件一律返回 501，client 该行应显示「当前宿主不支持切换」而非假按钮成功。
4. **持久化用插件自有 JSON 状态文件而非 `ctx.settings` 命名空间**：避免引入未声明的 `@deepseek-ai/dsh-settings`+`@deepseek-ai/schemastery` 运行时依赖；路径显式解析（`DSH_PROFILE_DIR/.dsh-my-settings/state.json` 优先，回退 `$DSH_HOME/profiles/<name>/.dsh-my-settings/state.json`），无法解析到显式目录时读写按「不可用」降级（读默认值、写 501），**绝不写 `process.cwd()`**。若日后把 `@deepseek-ai/dsh-settings` 升为 peer 依赖，可改挂命名空间（本设计已把持久化抽象在 `state-store`，替换点单一）。
5. **market/aa「effective」**：读侧 `effective`=持久化 `requested`（本插件不改写组合 bundle 真值），`legacyDefaulted` 仅在从未持久化且为默认 `disabled` 时 `true`；真正更换 provider 需宿主用 `desktopPnpm` 重装——本插件只持久化偏好并在 `capabilities` 如实上报是否可应用，不越权安装。
6. **外观/材质/LAN**：偏好可自洽持久化；`appearance.nativeCapable` 仅在 native host（`desktopRuntime` 存在）为 `true`，否则只读降级——不做任何 Electron 调用。
7. **HTTP 守卫用同源（Origin/referer + `sec-fetch-site`）而非强制 loopback**：client 由同一 DSH web server 服务，profile 可能运行于 LAN，故不硬编码 127.0.0.1 socket 校验（`http-handlers.isSameOrigin`）。

### 5.5 给 client agent 的对齐要求
- `src/client/desktop-settings-api.ts` 需与 `src/contract.ts` 的 `settingsPaths` + DTO 完全一致（基路径 `/api/dsh-my-settings`），并据此渲染降级 UI（读取 `DesktopSettingsView.capabilities[]`，对 `supported:false` 的 host.token 隐藏/只读）。
- 每个能力 token 都有 client 可读的 `unsupportedCode` 与 `reason`（渲染安全，不含原生路径）。

> 一致性确认（追加）：下方 §六 由 client agent 记录，其 client API 直接 `import { settingsPaths }` 与 contract DTO，与本节 §五 所述完全一致（基路径 `/api/dsh-my-settings`、read 投影字段、能力 token 集合、host 专属 action 501 语义均已逐项对齐）。

---

## 六、client 面实现记录（agent：client 源码）

> 已在 §5.5 契约定稿后按 `src/contract.ts` 镜像完成，**不照抄** dsh-desktop 的 `/api/desktop/*` 形状。

### 6.1 端点基路径与 DTO（客户端采用）

- 端点统一镜像 `src/contract.ts` 的 `settingsPaths`（基路径 **`/api/dsh-my-settings`**），client 直接 `import { settingsPaths }`，保证逐字节一致、永不漂移：
  - `GET  …/state` → `DesktopSettingsView`（全量投影）
  - `POST …/market/select` → `DesktopRestartAcceptance`
  - `POST …/aa/select` → `DesktopRestartAcceptance`
  - `POST …/notifications/update` → `{ accepted: true }`
  - `POST …/appearance/update` → `{ accepted: true }`
  - `POST …/restart | /terminal/open | /devtools/toggle | /diagnostics/export` → `{ accepted: true }`；不可用即 `501` + `SettingsErrorResponse{error,code,capability}`
- client 读体在进入 React state 前经 `parseDesktopSettingsView` 全量重校验（子解析器 `parseHostIdentity/parseProfile/parseCapability/parseNotifications/parseAppearance/parseMarket/parseAa/parseCurrent`），复用 contract 类型保证字段逐字节一致。
- `DesktopSettingsView` 形状：`{ current: string|null, host{desktopHost,bridges,profiles}, market{requested,effective,legacyDefaulted}, aa{requested,effective}, notifications{enabled,events{sessionEnd,errors,updates,progress}}, appearance{material,mode,nativeCapable}, capabilities[] }`。

### 6.2 我创建/改写的文件

- `src/client/index.ts`（新建）—— client 入口：`inject=['slots','locale','settingsScope']`；`apply(ctx)` 绑定 `dsh-desktop` 与 `dsh-desktop-notifications` 两个 settingsScope 命名空间、`locale.register('desktop.settings',{zh,en})`、`installDesktopSettingsStyles()`、`ctx.slots.inject('settings.section', …)` 注册 `DesktopSettingsSection`；`declare module '@deepseek-ai/dsh-client-ui-slots'{ interface LocaleNamespaceMap{ 'desktop.settings': DesktopSettingsLocaleKey } }`。
- `src/client/desktop-settings-api.ts`（改写）—— 镜像 contract：`createDesktopSettingsApi`、`read/selectMarket/selectAa/updateNotifications/updateAppearance/performHostAction`、`parseDesktopSettingsView/parseDesktopRestartAcceptance/parseDesktopActionAcceptance`、`DesktopSettingsError`、`desktopSettingsPaths`(=settingsPaths)。
- `src/client/DesktopSettingsSection.tsx`（重写）—— 按 contract 的 view 渲染 Profile/宿主、market、AA、notifications、appearance、宿主动作，读取 `view.capabilities[]` 做能力门控；注入面收窄为 `{ api, desktopSettings?, notificationSettings? }`。
- `src/client/desktop-settings-locales.ts`（重写）—— zh/en 各 **80 key 完全对齐**（自动校验一致）。
- `src/client/desktop-settings-styles.ts`（保留+补 `.dshDesktopSettingsChoiceStatic`）—— 注入 `<style id="dsh-desktop-settings-styles">`，headless 容错、按 id 去重、返回卸载闭包。
- 删除过时的 `src/client/environment.ts`、`src/client/desktop-network.ts`（旧 `/api/desktop` LAN/openBrowser 模型已废弃，contract 下无使用者；host 根文件均不引用）。
- 未新建 `DesktopNativeActions.tsx`/`DesktopTerminalSettingsAction.tsx`：宿主动作已并入页面「宿主动作」区块（按 capability 门控），settings.action 顶栏在 index.ts **不注册**；避免引入未声明依赖 lucide-react 与无法验证的 settings.action 合约。

### 6.3 相对 dsh-desktop 参考的降级改动清单

1. **读面**：抛弃 `DesktopSettingsView{current,profiles[exists/webCapable/selectable/deletable],aa,market{community,dsh},web{localUrl/lanUrls/...}}` 旧形状 → contract 的 `{current,host,market,aa,notifications,appearance,capabilities}`；LAN/browser URL 与 CA 信任区整块移除。
2. **注入面**：由参考的 `{api,platform,initialMode,micaSupported,setMode,desktopSettings,notificationSettings}`（全部必填、依赖 Electron environment）收窄为 `{ api }` 必填 + `desktopSettings?/notificationSettings?` 可选 registry 绑定；平台/材质即时生效不再由 client 判，改由 `appearance.nativeCapable` 与 `appearance.preference` 能力上报。
3. **外观/材质**：不再按 `environment.platform`（darwin/win32/linux）分派 macos/windows 材质；改为统一 material select（off/transparent/mica/acrylic）+ mode radio，`nativeCapable=false` 时显示「仅保存偏好」提示（持久化仍走 `appearance/update`）。
4. **通知事件**：dsh-desktop 的 turn/job 事件 → contract 的 `sessionEnd/errors/updates/progress` 四行。
5. **Profile**：列/选/建/删 web profile → 只读 host identity（当前 profile、bridge、directory 状态）；切换不提供（`host.profile-switch` 在 manifest 恒 unsupported，显示 reason）。
6. **能力降级**：每个交互控件先查 `capabilities[]`；`supported:false` → 禁用 + `UnsupportedNote` 显示服务端 `reason`；host 专属动作按钮仅 `host.*` token 且 `supported===true` 时可用，否则只读并显示 reason；非 2xx 统一转 `DesktopSettingsError`（capability/http/invalid）显示。
7. **Writes 均 POST 后 re-`read()` 刷新**：因 write 只返回 `{accepted}`/`DesktopRestartAcceptance` 而非全量 view，client 用 read 回填 state，避免猜测 write 响应形状。
8. **settingsScope 命名空间**：按客户端入口约定仍绑定 `dsh-desktop`/`dsh-desktop-notifications`（registry/discovery 表面，inject 含 settingsScope）；实际持久化值走 HTTP 状态（见 §5.4 #4），页面渲染不依赖其快照。



