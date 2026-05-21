---
name: 奚童表情反馈系统
description: Topbar 像素表情反馈系统的设计决策、视觉规格和原型文件位置
type: project
---

奚童表情反馈系统已完成 ideation，进入实现阶段。

**方向**: 10×10 像素 SVG 表情脸，放在 ReadingTopbar 正中间（替换进度圈），6 个状态（idle/thinking/happy/curious/reading/sleeping），前端状态机驱动，复用 humanized-adapter.ts 映射。

**Why**: 用户希望增加情感连接、状态可视化、趣味性和产品差异化。选择极简表情方案而非全身像素角色，因为辨识度更好、实现更轻量。

**How to apply**:
- 设计文档: `docs/ideas/pixel-xitong-expression.md`
- 视觉原型: `docs/ideas/pixel-xitong-prototype.html`
- 实现入口: `src/components/reading-topbar/reading-topbar.ts` 中间区域
- 状态驱动: 复用 `src/agent/ui/humanized-adapter.ts` 的工具调用映射
- CSS: `src/components/reading-topbar/reading-topbar.css`

**视觉确认**: 用户已确认 6 态表情设计（思考态最后调整为双眉抬高），原型文件中可预览。
