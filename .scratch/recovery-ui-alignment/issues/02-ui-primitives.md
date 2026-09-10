# 02 — UI 原语层（按需移植 shadcn 封装）

**What to build:** Tailwind 主题变量、`cn()` 工具、以及**按需**移植的 shadcn 风格组件。

**Blocked by:** 01

**Status:** ready-for-agent

## 实施依据（已实测）

参考实现的 `src/native-ui/components/ui/` 有 **13 个组件文件**，但它们是
**`dsh-desktop` 自写的封装**，不是第三方——头部形态：

```tsx
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.ts'
const buttonVariants = cva('inline-flex h-8 …', { variants: { variant: { … } } })
```

即：**第三方原语（`@base-ui/react`）+ 自家 `cva` 变体 + `cn()` 合并**。

**不追求把 13 个全搬**——按恢复页实际需要移植。

## 交付物

- [ ] `cn()` 工具（`clsx` + `tailwind-merge`）
- [ ] Tailwind 入口 CSS + 主题变量（浅/深两套）
- [ ] 按需移植组件：**button / card / alert / tabs / badge / scroll-area**
- [ ] 主题变量与既有 `DESKTOP_THEME_PALETTES` 的色值对齐

## 验收

- [ ] 能渲染出一页包含按钮（各变体）、卡片、标签页、警告条的展示页
- [ ] **浅色与深色都正常**
- [ ] 无控制台错误
- [ ] 全量测试基线不变（406 / 400 / 5）

## 不做

- 不移植恢复页用不到的组件（dialog / hover-card / sonner / switch / radio-group 等）
- 不接业务数据
