# FORGE Design System Master

> FORGE 是一款移动端、本地优先的自适应力量训练教练。本文档是原生 App 的视觉与交互 Source of Truth；页面专属规则位于 `design-system/forge/pages/`，并覆盖本文档中的同名规则。

**Project:** FORGE  
**Updated:** 2026-09-09  
**Product:** Local-first adaptive strength coach  
**Stack:** React Native + Expo Router  
**Style:** Dark OLED / Performance Minimalism  
**Dials:** Variance 4/10 · Motion 3/10 · Density 6/10

## 产品体验原则

1. 先给用户今天应该做什么，再解释为什么。
2. 结论优先，细节渐进展开，避免把训练数据堆成仪表盘。
3. 黑灰白负责层级，Lime 只强调行动、当前状态和有效进展。
4. 所有改变数据的操作都需要明确确认、结果反馈和可撤销路径。
5. AI 只提出建议；客户端负责确认、执行、撤销和展示真实状态。

## Color Tokens

| Token | Hex | 用途 |
|---|---|---|
| `background` | `#0B0B0D` | 页面背景 |
| `surface1` | `#151517` | 基础卡片、输入框 |
| `surface2` | `#1B1B1E` | 强层级卡片、按钮、列表行 |
| `elevated` | `#222226` | Sheet、Toast、浮层 |
| `textPrimary` | `#F4F4F5` | 标题、核心数据 |
| `textSecondary` | `#98989F` | 正文、解释、辅助信息 |
| `textTertiary` | `#85858B` | 非关键元信息；在 OLED 深色背景上保持可读，不得单独承载重要状态 |
| `accent` | `#C8FF3D` | 主 CTA、当前状态、主要进度 |
| `success` | `#55D98B` | 完成、正向趋势 |
| `warning` | `#FFB84D` | 需要关注的状态 |
| `danger` | `#FF6767` | 删除、错误、风险 |
| `border` | `#2A2A2E` | 卡片和控件边界 |
| `borderSubtle` | `#202024` | 分隔线、弱边界 |

实现来源：[src/design-system/tokens.ts](../../src/design-system/tokens.ts)

## Typography

- 使用系统 Sans，不强制远程字体加载；保证离线启动和原生渲染稳定。
- Display：40/44，训练总结关键数字。
- H1：28/34，Hero 决策标题。
- Title：26/32，页面标题。
- H2：21/27，卡片核心指标。
- H3：17/23，卡片标题、动作名。
- Body：15/22，正文与解释。
- Caption：13/18，辅助信息。
- Label：12/16，导航、状态标签、小标题。
- 正文不低于 15pt；交互控件不能因缩小文字而低于可读范围；底部导航标签至少 11/14，并使用 `textSecondary` 作为未选中态。

## Layout & Spacing

- 使用 4/8pt spacing rhythm：4、8、12、16、20、24、32、40、48。
- 页面水平内边距默认 20pt；窄屏可降至 16pt，但不允许横向滚动。
- 顶部、底部固定区域必须遵守 Safe Area。
- 固定底部 CTA 或 Rest Bar 必须为 ScrollView 预留等高底部空间。
- 390×844 和 360×800 是最低验收尺寸；同时检查平板与横屏。

## Interaction

- 所有可操作元素最小 44×44pt；Android 目标优先按 48dp 验证。
- 相邻可操作元素至少保持 8pt 间距。
- Pressed 反馈使用 opacity、背景色或边框变化，不改变布局尺寸。
- 微交互通常为 150–300ms；退出动效应比进入动效更快。
- 关键完成动作可使用轻触觉，但不在普通浏览中滥用震动。
- 按钮必须提供 disabled/loading 状态和可读的 accessibility label。

## Accessibility

- 所有 Icon Button 必须有 `accessibilityLabel`。
- 颜色不能是唯一状态信号；同时提供文字、图标或明确数值。
- 正常正文目标对比度至少 4.5:1；辅助文字至少 3:1。
- VoiceOver / TalkBack 阅读顺序应与视觉顺序一致。
- 支持系统 Dynamic Type 和 Reduce Motion；动效不可阻塞输入或导航。
- 表单字段使用可见标签、合适的键盘类型、就近错误信息和恢复动作。

## Component Rules

### Cards

- 默认使用 `surface1`，重点决策卡使用 `surface2`。
- 不使用渐变、Glow、玻璃态或装饰性大阴影。
- 一张卡只承载一个清晰目的；辅助信息通过展开或二级区域呈现。

### Buttons

- Primary：Lime 背景 + `background` 文字，高度约 54pt。
- Secondary：`surface2` 背景 + 边框，保持至少 44pt 高度。
- 同一屏只保留一个主要 CTA；破坏性动作必须使用 danger 色并要求确认。

### Sheets & Modals

- 使用 40pt 左右拖拽手柄、明确关闭按钮和系统返回行为。
- Scrim 使用约 40–60% 黑色，保证前景内容独立可读。
- Sheet 内容必须遵守底部 Safe Area，选项目标至少 44pt。

### Icons

- 统一使用 `@expo/vector-icons` 的 Ionicons。
- 使用 token 化图标尺寸：16、20、21、24pt。
- 禁止 Emoji 作为结构性图标；避免在同一层级混用填充与线性图标风格。

## Motion

- 当前默认采用轻量 Fade / Slide / Zoom，优先使用 transform 和 opacity。
- 动效表达状态变化、层级进入或操作结果，不做装饰性连续动画。
- 实现 Reduce Motion 后，所有非必要进入动效应降级为即时显示或极短淡入。

## Anti-Patterns

- 不把 FORGE 做成紫粉色 AI 聊天 Web 页面。
- 不把所有数据做成图表或指标墙。
- 不用固定日期、固定计时器或静态统计伪装真实数据。
- 不把 AI 输出直接当作已完成的数据变更。
- 不隐藏加载、错误、空数据、离线和保存失败状态。
