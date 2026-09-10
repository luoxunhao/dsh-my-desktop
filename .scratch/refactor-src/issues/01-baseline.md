# 01 — 记录重构基线

**What to build:** 在**任何**文件移动之前，出一次包并记录打包产物的 SHA256，作为后续每个
ticket 证明「行为未变」的基准。

这是整个重构的度量前提：纯结构重构不应改变产物。若后续 ticket 的产物哈希与基线不符，
就说明引入了非预期的行为变化。基线必须在第一次移动前采集，否则记录的就是移动后的状态，
失去对照意义。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 跑一次 `dist-local` 出包（走仓库既有构建入口）
- [ ] 记录 `release/win-unpacked/resources/` 下关键产物的 SHA256：桌面设置插件的
      `lib/index.js`、`lib/client.js`，以及 `desktop-bridge/` 下的全部文件
- [ ] 记录当前全量测试基线（预期 326 项 / 320 通过 / 5 失败，5 项为已知缺口）
- [ ] 把基线与采集命令写进 spec 目录下的基线文件，供后续 ticket 比对

**备注**：采集前先确认工作区是干净的（无未提交的 `src/` 改动），否则基线不可信。
