# 04 — 两阶段确认（preview → execute）

**What to build:** 破坏性操作的 preview → execute 两步确认，避免误点造成不可逆后果。

**Blocked by:** 03

**Status:** ready-for-agent

## 为什么

参考实现对卸载插件、回滚快照要求先预览再执行。我们目前是**一步直达**——
用户点一下就把插件卸了或把配置回滚了，没有确认也没有影响面提示。

## 语义（对齐参考实现的 `startup-recovery-controller`）

```
preview  →  { previewId, expiresAt }
execute  →  校验 previewId 存在 / 未过期 / 未消费 → 先消费再执行 → 结果
```

## 必须守住的性质

- [ ] **有效期 5 分钟**；过期后 execute 返回 `preview-expired`
- [ ] **一次性消费**：同一 previewId 第二次 execute 必须失败
- [ ] **先消费再执行**：避免执行中途失败后 preview 仍可重放
- [ ] **数量上限**：preview 缓存有上限，防长时间运行内存膨胀
- [ ] **目标失效**：preview 创建后目标被改动/删除 → execute 返回 `invalid-target`
- [ ] 错误码至少包含：`preview-expired` / `invalid-target` / `operation-failed`

## 测试缝（沿用现有缝）

**业务逻辑做成不 import electron 的纯模块**（时间通过 `now()` 注入）——
与 `restart-service.ts` 的做法一致，因此能在**裸 node** 下测透。

仓内 33 个测试绝大多数是纯 node、零 electron 依赖，**不引入 vitest / jsdom**。

## 验收

- [ ] 单测覆盖：**过期**、**重复消费**、**并发 execute**、**数量上限**、**目标失效**
- [ ] 每条关键性质做**反向验证**（去掉保护后测试必须失败）
- [ ] 全量测试基线不变（406 / 400 / 5）

## 不做

- 不引入前端组件测试栈
- 不为每种操作各写一套 preview 逻辑（应共享同一套 store）
