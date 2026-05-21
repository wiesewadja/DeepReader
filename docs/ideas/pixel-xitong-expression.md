# 奚童表情反馈系统

## Problem Statement

How Might We：让奚童在 Topbar 中通过极简像素表情实时反映 Agent 状态，给用户状态可视化和情感陪伴感？

## Recommended Direction

在 ReadingTopbar 正中间放置一个 10×10 像素的 SVG 表情脸，替代现有进度圈的位置。纯前端状态机驱动，零额外 API 调用。表情根据 Agent 工具调用和交互上下文自动切换，鼠标悬停显示状态气泡。

## 表情定义（6 态）

| 状态 | 触发条件 | 表情特征 |
|------|---------|---------|
| idle | 默认 | 正常圆眼 + 小微笑 + 腮红 |
| thinking | Agent 工具调用中 | 双眉抬高 + 眼上移 + 嘴偏右 |
| happy | 用户满意 / 完成阶段 | ^_^ 弯眼 + 大咧嘴 + 腮红 |
| curious | 用户提出新问题 | 大圆眼 + O 嘴 |
| reading | Agent 深度阅读中 | 半闭眼（眼皮盖下半）+ 眉微皱 + 嘴抿 |
| sleeping | 无交互 >5min | 闭眼横线 + 无嘴 |

## 实现规格

- **画布**: 10×10 像素，SVG 内联渲染，`image-rendering: pixelated`
- **颜色**: 墨黑轮廓 + 暖肤 + 素白眼白 + 腮红 + 嘴色（见色板）
- **位置**: `ReadingTopbar` 中间，替换进度圈
- **切换**: JS 替换 SVG `innerHTML`，由前端状态机驱动
- **交互**: 悬停显示气泡文字，点击随机小动画
- **进度信息**: 合并到表情旁边（小数字或去掉）

## 状态驱动逻辑

复用现有 `humanized-adapter.ts` 的工具调用映射：
- `search_chunks` / `get_outline` → thinking
- `analyze_reading` / `syntopical_analysis` → reading
- 用户发送消息 → curious
- 收到正面反馈 / 完成阶段 → happy
- 空闲超时 → sleeping
- 其他 → idle

## Key Assumptions to Validate

- [ ] 10×10 像素在 28-36px 显示尺寸下表情可辨 — 在实际 Topbar 中测试
- [ ] 用户不觉得像素风与 Obsidian 美学冲突 — 先上线可选开关
- [ ] 前端状态机足够智能，不需要 LLM 情绪标注 — 先用工具调用映射
- [ ] 进度圈移走或合并后不影响用户习惯 — 考虑进度数字放表情旁

## MVP Scope

- 6 个 SVG 像素表情
- ReadingTopbar 中间渲染
- 前端状态机切换（基于 humanized-adapter）
- 悬停气泡
- 设置开关（可关闭表情）

## Not Doing

- 全身像素角色 — 太复杂，MVP 先验证表情价值
- LLM 情绪标注 — 增加延迟和 token，前端状态机够用
- 长期情绪演化系统 — MVP 后再考虑
- 自定义换装/换表情 — 非核心
- 消息头部头像替换 — 先聚焦 Topbar 一个位置
- 信封封面表情 — 后续迭代

## 视觉原型

参见 `pixel-xitong-prototype.html`（同目录）
