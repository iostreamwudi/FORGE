# FORGE 实施路线与体验验收标准

> 这份文档是 FORGE 的可迭代执行记录，不是不可变的产品总纲。每个阶段只交付一个可验证的用户闭环；当真实用户体验更好时，可以调整后续路线。完成一个阶段后，必须先通过 TypeScript、Lint 和 `ui-ux-pro-max` 的设计/UX 复查，再进入下一阶段。

## 产品北极星

FORGE 不是帮助用户记录健身，而是持续理解训练、营养、恢复和目标，把复杂数据转化成每天可以直接执行的决定，并让用户知道为什么。

核心循环：

```text
感知 → 判断 → 调整 → 执行 → 学习
```

## 分阶段路线

### Step 0 — V0.2 基础闭环（当前）

- React Native / Expo 原生工程与路由
- Performance Minimalism 设计系统
- 今日、饮食、Food Pool
- Active Workout、Rest Timer、Workout Summary
- 中文界面与五项底部导航

历史说明：早期原型曾以 Mock / 内存状态承载核心数据；当前商业化改造要求以真实账户、训练、营养与同步服务替换所有演示数据，详见 `FORGE_UIUX_OPTIMIZATION_ROADMAP.md` 的“商业化真实性审计”。

### Step 1 — V0.3 Goal + Body State + DailyPlan（当前实施批次）

用户能够：

1. 选择减脂、增肌、体态重组或维持目标。
2. 手动记录体重、睡眠、疲劳和酸痛；没有健康设备也能完整使用。
3. 在今日页看到基于目标和状态的计划说明。
4. 查看 FORGE 调整的原因、来源和更新时间。
5. 应用或撤销调整，而不需要跳转多个页面。

本批次不接 AI、Voice、SQLite Repository、Supabase、HealthKit 或新的大模块。

### Step 2 — V0.4 Nutrition Core

- 目标热量与宏量营养的确定性计算
- 摄入、剩余和记录后的重新规划
- Food Pool 的真实份量与营养语义
- Meal Optimizer 的最小打扰策略

### Step 1.5 — C 端商业化感改造（新增）

在进入更复杂的计算之前，先把现有能力包装成完整、可信、有品牌识别度的消费级产品：

- Today 从“卡片集合”收敛为一个明确的今日决策页
- 统一 FORGE 的品牌语言：发生了什么、为什么、现在怎么做、完成后会怎样
- 降低重复卡片和开发版占位感，建立 Hero Decision / Supporting Card / Inline Information 三层视觉层级
- 将训练、教练、进展入口先做成最小真实页面，不再显示纯占位提示
- 训练入口先提供下一次训练、本周计划和最近一次完成记录，确保用户可以直接进入执行闭环
- 补齐账户入口：登录、注册、我的/个人中心；底部导航收敛为五项，将“我的”固定在最右侧、智能教练置于中央，饮食并入 Today 摘要入口
- 统一移动端字体层级，降低标题与指标的视觉噪音，同时保留可读性和 44pt 触控区域
- 补齐首次打开、空数据、加载、保存、错误、离线和完成反馈
- 每个切片完成后必须重新通过 `ui-ux-pro-max`、TypeScript、Lint 和移动端视口验证

### Step 3 — V0.5 Adaptive Engine V1

- 根据 Goal、Body State、History 调整训练量、强度、营养分配和恢复建议
- 周策略稳定，日目标只做小幅调整
- 使用趋势，不被单日体重或单个设备数字牵着走

### Step 4 — V0.6 Context-Aware Coach

- Explanation + Action 的回答结构
- 可直接应用到训练或饮食的 Coach Action
- Today、Workout、Nutrition、Progress 共享上下文

### Step 5 — V0.7 Progress

- 结论优先的进展首页
- 体重、力量、训练执行、营养执行和 PR 趋势
- 每个结论都能回溯到数据和时间范围

### Step 6 — V0.8–V1.0 基础设施与智能能力

按顺序接入 SQLite / Repository、Apple Health / Health Connect、真实 AI Explanation 和全局 Voice；每一项都必须替换现有边界，而不是让页面直接依赖平台或模型。

## 全局体验验收

- 手机竖屏优先：390×844、360–430dp 宽度；同时检查小字体放大和横屏降级。
- 所有可操作控件触控区域 ≥44pt；按钮约 54pt；列表行约 48pt。
- Safe Area、键盘、Rest Timer、Sticky Button 都不能遮挡内容。
- 每个页面只保留一个主要 CTA；结论先于细节；复杂设置使用渐进披露。
- 颜色遵循黑/灰/白 + Lime 语义 Token；禁止渐变、Glow、玻璃态和装饰性大动画。
- Pressed 状态不能造成布局跳动；关键动作使用轻触觉，支持减少动态效果。
- 加载、空数据、错误、离线、数据过期和无设备路径必须有明确反馈。
- 每次实现完成后运行：`pnpm typecheck`、`pnpm lint`，并重新调用 `ui-ux-pro-max` 做设计系统、移动端 UX、无障碍和交互检查。

## 当前批次的完成定义

Step 1 只有在以下条件全部满足时才算完成：

- Goal 与 Body State 有清晰、可扩展的领域模型。
- Today 展示的计划来自稳定的 DailyPlan，而不是页面内散落的临时字段。
- 用户可以在无设备情况下完成录入、确认、修改和撤销。
- 状态变化能立即反映在 Today，并且不会破坏现有训练、饮食和总结流程。
- 390×844 与 360–430dp 宽度下无横向溢出、底部遮挡或不可点击区域。
- TypeScript、Lint 和 `ui-ux-pro-max` 复查通过。
