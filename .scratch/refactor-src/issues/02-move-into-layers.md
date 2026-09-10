# 02 — 建分层目录 + 纯移动（零代码改动）

**What to build:** `src/` 从 45 个文件全平铺变为按层组织的目录结构，让每个文件的归属从路径
即可判断。**本次只移动文件与改 import 路径，不改任何逻辑。**

目标结构（按层，跨层只能向下依赖）：

- `app/` —— 进程级身份与生命周期
- `infra/` —— 无业务语义的工具
- `runtime/` —— DSH 运行时装配
- `profiles/` —— profile 领域
- `bridge/` —— 注入 DSH 子进程的宿主桥
- `desktop/` —— Electron 主进程 UI
- `recovery/` —— 恢复模式

`main.ts` 保留在 `src/` 根目录。三个 preload `.cts` 脚本**保持扁平不动**（移动需同步改
`resolvePreload()`，改错即白屏，且 agent 无法启动 Electron 验证）。

**这是一个"爆炸半径"横跨全仓的原子改动**：41 个测试的 import、`extraResources` 的 15 个扁平
文件名 filter、smoke 脚本的 `dist/src/...` 引用、`resolvePreload()` 的硬编码路径全都指向旧位置，
一次移动会同时打断所有调用点。经确认保持为单个 ticket，不做 expand–contract 分批——纯移动的
断链会被 TypeScript 编译期全部抓出，不存在静默失败，不值得为此维护两套路径。

**Blocked by:** 01 — 记录重构基线

**Status:** done — 见下方「执行结果」

- [x] 建立分层目录，41 个文件以 `git mv` 移动（保留 git 重命名历史）；
      `main.ts` 与 3 个 preload `.cts` 按计划留在 `src/` 根
- [x] 同步更新测试与脚本的 import 为分层路径（`../src/<layer>/<name>.js`）
- [x] 同步更新 `extraResources`：改为指向 `dist/bridge-flat/` 与 `dist/extract-flat/`
- [x] 同步更新 smoke 脚本中的 `dist/src/...` 引用
- [x] `check:all` 通过、全量测试 **327 / 321 / 5**（与 01 基线一致，无新增失败）
- [x] `dist-local` 出包成功；打包产物哈希：**14/15 个 bridge 文件与基线一致**，
      1 处已确认差异（见下）
- [x] 确认 `src/` 下不再有平铺的 45 文件；每个文件可从目录判断所属层

## 执行结果

### 计划外发现：仓库有两个「扁平发布单元」

原计划假定「分层 = 纯移动」。实际上有两处产物是**扁平发布**的，它们的源文件必须编译成
同目录兄弟文件才能工作：

1. `resources/desktop-bridge/` —— 15 个文件，彼此用 `./x.js` 互相 import
2. `resources/extract-runtime.mjs` —— 与 `runtime-archive.js`、`process-control.js` 平铺在
   `resources/` 根

移动前它们能扁平，**纯粹因为源文件本来就全在 `dist/src/` 平铺**。分层后编译产物变成
`dist/src/bridge/x.js`、`dist/src/infra/y.js`，扁平发布就断了。

**解法**：新增 `scripts/stage-flat-units.ts`（`build:flat`），在 `tsc` 之后把两个发布单元的
成员拷到 `dist/bridge-flat/`、`dist/extract-flat/`，并把跨目录 import 重写为同目录 `./x.js`。
`extraResources` 改为指向这两个暂存目录。缺成员会**直接报错**，不会静默产出坏包。

### 产物哈希差异（已确认接受）

15 个 bridge 文件中 **14 个与基线逐字节一致**，只有 `desktop-host.js` 不同。

原因：dev 模式下 `resolveDesktopBridgeDir()` 原本返回 `dist/src`（当时扁平），现在必须返回
`dist/bridge-flat`——否则 dev 启动会因分层路径找不到 bridge 的依赖文件。这是分层重构的必然
结果，非逻辑变更。

`resolvePreload()` 未改动（preload 保持扁平，已验证 `dist/src/*.cjs` 仍在原位）。

### 其他

- 修改过程中发现并修正了自己的一个工具 bug：import 重写脚本一度把 `scripts/`、`test/` 的
  `../src/x.js` 误改成 `../x.js`（丢掉 `src/` 段），以及把 `.js` 误写成 `.ts`。已回退重做，
  最终以 `check:all` 全绿为准。


**备注**：本 ticket 完成后，跨层依赖方向应当已经成立（跨层只能向下）。若发现反向依赖，
记录下来供后续 ticket 处理，但**不要在本 ticket 内改逻辑**。
