# 阶段 6 进度记录

## 已完成

| Ticket | 内容 | 提交 | 新增测试 |
|---|---|---|---|
| **07** | 数据目录状态与切换 | `ffb73f0` + `9f9cae6` | +14 |
| **08** | 出厂重置（四条安全拒绝） | `ec7d262` | +13 |
| **09** | 打开配置文件与目录（动作白名单） | `c39302f` | +7 |
| **01** | 构建链接线（Vite + React + Tailwind） | `6103772` | +6 |

全量测试从 **406/400/5** → **446/440/5**（新增 40 条，5 项已知缺口始终不变）。

### ticket 01 实施中踩到的三个真实问题

**1. ES module 在 `file://` 下不会执行**（最隐蔽的一个）

我们沿用 `loadFile`（`file://`），而浏览器**拒绝**从 `file://` 文档执行
`<script type="module">` —— 模块请求被当作 opaque origin 的 CORS 而静默拦截。

症状：文档加载成功、脚本从未运行、**窗口一片空白、控制台无任何报错**。

实测确认：极简 `<script type=module src=./m.js>` 在 headless Chrome 里目标元素
完全没被修改，而经典 `<script>` 正常。

解法：Vite 输出 IIFE（`format: 'iife'` + `inlineDynamicImports`），
并用构建后插件去掉 script 标签上的 `type="module"` 与 `crossorigin`。
参考实现不需要这步——它用自定义 scheme 而非 `file://`。
代价是不支持代码分割，单窗口恢复页不需要。

**2. 经典脚本在 head 中早于 body 执行**

module 脚本会自动 defer，经典不会。所以挂载时必须等 `DOMContentLoaded`，
否则 `getElementById('root')` 返回 null 并抛「缺少 #root 挂载点」。

**3. 守卫测试抓到硬编码断言**

新增 `build:recovery-ui` 后，`prepare-runtime.test.ts` 里一条**把 `build:all`
与固定字面量做全等比较**的断言失败。该断言本意是「所有出包路径最终都构建插件」，
硬编码使它一加合法步骤就误报。已改为**校验顺序**，
并处理了 `pnpm run build` 会前缀命中 `pnpm run build:plugin` 的匹配陷阱。

### ticket 07 的架构教训（已修，提交 `9f9cae6`）

最初把数据目录解析做进了 `resolveProfileRoots()`，**打包守卫立刻报错**：

```
扁平发布单元 dist/bridge-flat 缺少依赖：profiles.js 引用了
../recovery/data-directory.js，但 data-directory 不在成员列表里
```

原因：`profiles.ts` 属于 **bridge 扁平发布单元**（15 个文件扁平发布到
`resources/desktop-bridge/`，注入 DSH 子进程），该单元成员只能 import 同级兄弟。

分析后确认**不该**把 `data-directory` 加进那个单元：它是启动器主进程的关注点，
子进程根本不需要 —— 子进程的 home 要么由调用方显式传入（`desktop-host` 从
`profileDir` 推导），要么来自启动器设置的环境变量。把主进程关注点塞进子进程的
发布单元，既无收益，也**本来就无效**（子进程的环境由父进程决定）。

正确做法是分层：`profiles.ts` 保持纯净，新增 `src/desktop/launcher-roots.ts`
在启动器侧解析选择，再把结果作为显式 `home` 传进去。

**这条经验对后续 ticket 都适用**：改动前先确认目标文件属于哪个发布单元。

## 待办

| Ticket | 内容 | Blocked by |
|---|---|---|
| 02 | UI 原语层（按需移植 shadcn） | 01 ✅ |
| 03 | API 层 + checkpoint/profile 接线 | 01 ✅ |
| 04 | 两阶段确认 | 03 |
| 05 | UI 重建 | 02, 04, 07, 08, 09 |
| 06 | 接线替换旧页与收尾 | 05 |

**02 与 03 现在都解锁了**（01 已完成）。

## 每轮验证纪律（本轮新增）

**验证结束后必须清理测试实例。**

阶段 4/5 的验证我反复用 `--dsh-desktop-recovery` 启动应用却未清理，
一个恢复模式实例占着**单实例锁**，导致用户之后的启动全部被挡住 ——
而恢复模式**按设计不启动 DSH Host**，表现正是"应用坏了"。

**规则**：每轮验证收尾时，显式停掉 `DSH My Desktop` / `electron` / DSH 子进程，
并在给出结论前确认进程数为 0。

