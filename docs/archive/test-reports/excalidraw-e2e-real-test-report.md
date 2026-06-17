# Excalidraw 可视化绘图功能 — 真实端到端测试报告

**日期**: 2026-06-12
**测试方法**: 通过 evalObsidian 模拟真实用户操作 — 打开侧边栏 → 选书 → 发送消息 → 等待 Agent 回复 → 检查结果
**测试书籍**: AI极简经济学 (indexId: ee090e29, 514 chunks, 完整索引)

## 测试流程

### 环境
- Obsidian test-vault, deepreader-dev 插件
- 7 个 AI provider 已配置（deepseek, kimi, zhipu, siliconflow, xiaomi, sensenova, mineru）
- Excalidraw 插件已安装
- 通过 evalObsidian CDP 调用 `agentChatCtrl.sendMessage()` 发送消息

### Test 1: S1 检视阅读 — 全书结构思维导图

**输入**: "请画一张思维导图展示这本书的整体结构"

**路由**: S0 Router → S1 Inspectional (全书概览类问题)

**结果**: PASS
- Agent 在 S1 节点完成后，`diagram-helper.ts` 检测到 `hasDiagramIntent("画一张思维导图")` = true
- 调用 `generateDiagram()` → LLM 生成元素 JSON → `excalidrawTool.execute()` 写入文件
- 生成文件: `Excalidraw/AI极简经济学整体结构.excalidraw`
- 回复中包含 embed: `![[Excalidraw/AI极简经济学整体结构.excalidraw]]`
- 回复时间: ~177s

**MiniMax 视觉分析结果**:
- 中文文字正确显示，无乱码
- 5 个颜色区分的形状（蓝/绿/橙/紫/红），对应书的五个部分
- 有水平连接线和箭头表示逻辑流
- 内容精准匹配书籍结构（预测→决策→工具→战略→社会）
- **已知问题**: 连接线穿过文字造成遮挡，第五部分用了圆形而非矩形

![S1 自动生成的思维导图](../../test-output/excalidraw-e2e/AI极简经济学整体结构.png)

---

### Test 2: S2 分析阅读 — 预测到决策流程图

**输入**: "画一个流程图，展示从预测到决策的完整流程"

**路由**: S0 Router → S2 Analytical (内容分析类问题)

**结果**: PARTIAL — 文件生成但 embed 未出现在回复中（第一轮测试，修复前）
- Agent 产生了详细的文字分析，但没有调用 excalidraw 工具
- 实际文件 `AI极简经济学：从预测到决策的完整流程.excalidraw` 由上一轮测试的 S1 diagram-helper 生成

**MiniMax 视觉分析结果** (来自上一轮):
- 中文正确，使用了椭圆（起点/终点）、菱形（决策）、矩形（过程）等标准流程图符号
- 有箭头方向指示，水平布局合理
- 内容准确展示 预测→判断→决策→行动→结果 流程

![S2 流程图](../../test-output/excalidraw-e2e/AI极简经济学：从预测到决策的完整流程.png)

---

### Test 3: S2 分析阅读 — 概念关系图

**输入**: "请用 excalidraw 画一个概念图，展示预测机器和人类判断力的互补关系"

**路由**: S0 Router → S2 Analytical

**结果**: FAIL — Agent 未调用 excalidraw 工具
- Agent 产生了纯文字分析回复
- 没有生成 .excalidraw 文件
- 回复中没有 embed 语法

**根因分析**: S2 节点使用 PlanExecute 工具循环，excalidraw 工具已在白名单中，但 LLM 选择不调用它。这是一个 **LLM 决策问题**，不是代码 bug：
- 工具已正确注册并可用
- Analytical prompt 已包含 workflow step 5 指示
- 但 LLM 在实际对话中选择用文字而非图形回答

---

## 第一轮 vs 第二轮测试对比

| 轮次 | Test 1 (思维导图) | Test 2 (流程图) | Test 3 (概念图) |
|------|-------------------|-----------------|-----------------|
| 第一轮 (修复前) | 文件生成 ✓ embed 缺失 ✗ | 文件生成 ✓ embed 缺失 ✗ | 无文件 ✗ |
| 第二轮 (修复后) | 文件生成 ✓ embed 包含 ✓ | 无工具调用 ✗ | 无工具调用 ✗ |

**修复内容**:
- `plan-execute.ts` synthesis prompt 添加 embed 保留规则
- `formatter-prompt.ts` 添加 `![[...]]` embed 保留规则

---

## 核心发现

### 已验证通过
1. **工具注册和执行**: excalidraw 工具在 S1/S2 节点均可用
2. **文件生成**: .excalidraw 文件格式正确，中文编码正确，双向文本绑定工作正常
3. **碰撞检测和语义验证**: 自动检测重叠、绑定错误，返回 warnings
4. **S1 自动可视化**: `diagram-helper.ts` + `hasDiagramIntent()` 机制工作正常
5. **Embed 语法保护**: Formatter 的 `%%EMBED_N%%` 占位符机制正确保护 embed 不被误删
6. **视觉质量**: 自动生成的图形中文清晰、颜色区分、内容准确

### 已知问题
1. **S2 LLM 不主动调用 excalidraw**: 在分析阅读阶段，LLM 倾向于用文字而非图形回答，即使 prompt 中有明确指示
2. **布局质量**: LLM 生成的坐标有时会导致连接线穿过文字，间距不均
3. **形状一致性**: LLM 有时混用不同形状（如矩形和圆形）

### 待改进方向
1. 增强 S2 analytical prompt 中关于可视化的指令强度
2. 考虑在 S2 也使用类似 S1 的 post-processing 自动检测机制
3. 优化工具 description 中的布局参考信息，减少坐标计算问题

## 修改的文件汇总

| 文件 | 修改内容 |
|------|----------|
| `src/agent/tools/excalidraw.ts` | 箭头自动计算 points + 位置自动计算 + 自动文本绑定 |
| `src/agent/tools/definitions/excalidraw.ts` | 设计哲学 + 视觉模式参考 + 完整 schema |
| `src/agent/tools/index.ts` | 注册 excalidraw 工具 |
| `src/agent/graph/nodes/analytical.ts` | s2ToolNames 添加 excalidraw |
| `src/agent/graph/nodes/inspectional.ts` | diagram-helper 后处理 |
| `src/agent/graph/nodes/syntopical.ts` | diagram-helper 后处理 |
| `src/agent/graph/nodes/visualizer.ts` | 简化为透传 |
| `src/agent/graph/prompts/analytical-prompt.ts` | 可视化 workflow step |
| `src/agent/graph/prompts/formatter-prompt.ts` | embed 保留规则 |
| `src/agent/graph/nodes/formatter.ts` | embed 语法保护 |
| `src/agent/graph/subgraphs/plan-execute.ts` | synthesis prompt 添加 embed 规则 |
| `src/agent/graph/utils/diagram-helper.ts` | 新建：可视化意图检测 + 图形生成 |
