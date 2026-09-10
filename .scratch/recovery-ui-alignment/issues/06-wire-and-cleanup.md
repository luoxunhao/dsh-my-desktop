# 06 — 接线、替换旧页与收尾

**What to build:** 用新恢复页替换旧的 `assets/recovery.html`，清理旧实现，收尾文档。

**Blocked by:** 05

**Status:** ready-for-agent

## 交付物

- [ ] 新的恢复页接管恢复窗口的加载（dev 与打包两条路径）
- [ ] **确认无引用后**删除旧 `assets/recovery.html`，并清理 `extraResources` 中的对应条目
- [ ] 更新本 spec 目录下的进度记录
- [ ] 更新 `AGENTS.md`：新增的前端构建链、命令、以及"改完怎么生效"的说明
- [ ] 更新测试基线数字（当前 406 / 400 / 5）

## 验收（必须实测两条路径）

- [ ] `pnpm start`：带 `--dsh-desktop-recovery` 启动能进新恢复页
- [ ] `dist-local` 出包安装后同样能进新恢复页
- [ ] **恢复模式下不启动 Host**（阶段 5 已实现的性质不得回退）：
      实测确认恢复模式无 DSH 子进程、无监听端口
- [ ] 正常启动不受影响（A/B 对照：正常启动有 Host，恢复模式无 Host）
- [ ] 全量测试基线不变或更好

## 收尾

- [ ] 记录本阶段与参考实现的**有意差异**（IPC vs scheme、未做的三块功能）
- [ ] 记录引入前端工具链的**代价**（依赖面扩大、上游升级需跟）

## 不做

- 不替换其它 5 个原生 HTML 页面（shell / settings / about / shortcuts / startup）
- 不做阶段 7（ticket 13 原定的 main.ts 重构收尾）
