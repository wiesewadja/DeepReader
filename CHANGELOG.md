# Changelog

All notable changes to DeepReader will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2026.06.13] - 2026-06-13

### Added
- **F-36 Excalidraw 可视化**: VISUALIZER 节点从占位升级为真实图表生成，支持 11 种关键词（思维导图/脑图/流程图/概念图/画X图/可视化/导图/示意图/infographic/图表/知识图谱），S1/S2/S3 三种深度均可触发
  - 新增 `excalidraw` 工具（第 14 个 LangChain tool）：元素转换 + 碰撞检测 + 文件写入 Vault
  - 新增 `diagram-helper.ts`：意图检测 regex + LLM 调用 + JSON 提取
  - 激活 `hasDiagramIntent` 路由（替换硬编码 `return false`）
  - 箭头边缘交点计算（edgeIntersection）、Z-index 排序、自适应视口、文本碰撞检测
  - Formatter 新增 embed 占位符保护（`%%EMBED_N%%`），防止 wiki link 后处理误删嵌入语法
  - Router prompt 新增可视化路由规则（type C depth=1）
  - 54 个相关单元测试 + 14 个 E2E 场景验证

### Fixed
- `detectTextOverlaps` text-vs-text 坐标计算错误（`a.y + b.height` → `a.y + a.height`）
- `definitions/excalidraw.ts` 视觉模式规则与 `diagram-helper.ts` prompt 不一致
- `inspectional.ts` 多余中间变量还原为直接 return

### Changed
- `agent-overview.md` 工具层数量 9→10
- `L6-tools.md` 工具数 13→14，新增 excalidraw 条目
- `L4-nodes.md` Visualizer 章节从"占位"重写为真实实现
- `L2-langgraph-state-machine.md` 路由描述和 safeNode 状态修正
- `features/README.md` 新增 F-36 条目
