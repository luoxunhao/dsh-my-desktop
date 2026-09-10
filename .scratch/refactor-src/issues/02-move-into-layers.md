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

**Status:** ready-for-agent

- [ ] 建立分层目录，45 个文件以 `git mv` 移动（保留 git 重命名历史）
- [ ] 同步更新 41 个测试文件的 `../src/<name>.js` import 为分层路径
- [ ] 同步更新 `extraResources` 的 `desktop-bridge` 组：`from` 与 15 个文件名 filter
      必须指向新子路径 —— **漏改的失败方式是"构建成功但运行时缺文件"，务必逐项核对**
- [ ] 同步更新 smoke 脚本中的 `dist/src/...` 引用
- [ ] `check:all` 通过、全量测试仍为 326 / 320 / 5（同样的 5 项已知失败，不新增）
- [ ] `dist-local` 出包成功，且**打包产物哈希与 01 基线逐字节一致**
- [ ] 确认 `src/` 下不再有平铺的 45 文件；每个文件可从目录判断所属层

**备注**：本 ticket 完成后，跨层依赖方向应当已经成立（跨层只能向下）。若发现反向依赖，
记录下来供后续 ticket 处理，但**不要在本 ticket 内改逻辑**。
