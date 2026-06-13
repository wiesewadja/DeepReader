# Excalidraw 可视化绘图功能测试策略

## 功能概述

Excalidraw 工具允许奚童通过 LLM 生成可视化图形（思维导图、流程图、概念图等），写入 .excalidraw 文件并嵌入聊天回复。涉及 4 个代码层：

| 层 | 文件 | 职责 |
|---|---|---|
| 工具执行器 | `src/agent/tools/excalidraw.ts` | 接收 LLM 生成的元素 JSON，碰撞检测 + 语义验证，构建 .excalidraw 文件，Vault API 写入 |
| LangChain 包装 | `src/agent/tools/definitions/excalidraw.ts` | Zod schema + 设计哲学 description，闭包注入 ToolContext |
| Diagram helper | `src/agent/graph/utils/diagram-helper.ts` | S1/S3 后处理绘图：意图检测 + LLM 生成 JSON + 降级处理 |
| 节点集成 | `inspectional.ts`, `syntopical.ts`, `analytical.ts`, `edges.ts` | S1/S3 后处理调用 diagram-helper，S2 工具白名单含 excalidraw |

## 风险评估

| 维度 | 评级 | 理由 |
|------|------|------|
| 业务影响 | 高 | 可视化是差异化功能，直接影响用户体验 |
| 修改范围 | 跨模块 | 工具执行器 + LangChain 包装 + 图节点 + 路由规则 |
| 依赖 | 混合 | 单元层 mock Vault API；端到端需真实 LLM + Obsidian |

## 选用策略

- [x] 策略 A：新功能（垂直切片）

## 测试层级

### 层级 1：单元测试（已存在，需验证）

**文件**：`tests/unit/agent/tools/excalidraw.test.ts`（314 行，12 个用例）

| 测试面 | 覆盖用例 | 缺口 |
|--------|---------|------|
| buildExcalidrawJSON | 4 个（结构、文本默认值、箭头绑定、seed 递增） | line 类型未测 |
| detectOverlaps | 4 个（重叠检测、小重叠忽略、无重叠、文本/箭头排除） | 椭圆/菱形重叠未测 |
| validateSemantics | 5 个（无颜色文本、容器内文本豁免、无效 containerId、双向绑定、箭头绑定缺失） | 容器比例边界值未测 |
| excalidrawTool.execute | 4 个（写入成功、目录创建、缺参数、空元素） | Vault 写入异常未测 |

**缺失覆盖**（建议补充）：
- `line` 类型元素的转换逻辑（points 处理、width/height 置 0）
- `diamond` 类型 roundness 设置
- `fontSize` 默认值边界（0 / 负数）
- 多行文本高度自动计算
- seedCounter 重置（`resetSeedCounter` 在每次 `buildExcalidrawJSON` 开头调用）
- Vault adapter.write 抛异常时的错误返回
- `filename` 含特殊字符（`/`, `..`, `\0`）

### 层级 2：冒烟测试

**不新增**。excalidraw 工具不涉及插件加载或 UI 挂载，无需冒烟检查。

### 层级 3：轻量 E2E / E2E CLI

**核心端到端验证**。通过 `evalObsidian` 在运行中的 Obsidian 内触发对话，验证 4 个场景：

| 场景 ID | 场景名称 | 触发路径 | 预期行为 |
|---------|---------|---------|---------|
| E-EX-1 | S1 检视思维导图 | "画一个思维导图总结这本书" | S1 路由 → diagram-helper → 生成 .excalidraw → 回复含嵌入 |
| E-EX-2 | S2 分析概念图 | "解释这个概念，画个图" | S2 路由 → excalidraw 工具调用 → 生成 .excalidraw → 回复含嵌入 |
| E-EX-3 | 直接绘图指令 | "画一个流程图" | intent-rules 匹配 action_output → excalidraw 工具调用 |
| E-EX-4 | 普通问题不触发 | "这本书讲了什么" | 正常回复，不生成 .excalidraw 文件 |

**每个场景的检查项**：
1. 是否生成了 `.excalidraw` 文件（场景 4 除外）
2. 文件 JSON 结构：`type: "excalidraw"`, `version: 2`, `elements` 数组非空
3. 元素无严重碰撞（overlapArea > 1000 的警告数）
4. 聊天回复包含 `![[Excalidraw/xxx.excalidraw]]` 嵌入语法
5. 回复非空且 ≥ 100 字符

### 层级 4：Diagram Helper 单元测试（未覆盖，建议新增）

`diagram-helper.ts` 目前 **无任何单元测试**，但它包含核心逻辑：

| 函数 | 需测试行为 |
|------|-----------|
| `hasDiagramIntent` | 正则匹配 14 个关键词；不含关键词的查询返回 false |
| `generateDiagram` | LLM 返回有效 JSON → 生成成功；LLM 返回非 JSON → 空字符串降级；缺少 filename/elements → 空字符串；excalidrawTool 抛异常 → 空字符串 |

### 层级 5：.excalidraw 文件结构验证

生成的文件必须满足：

```
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [...],
  "appState": { "viewBackgroundColor": "#ffffff", "gridSize": 20 },
  "files": {}
}
```

每个 element 必须有：
- `id`, `type`, `x`, `y`, `width`, `height` — 非空
- `seed` — 递增
- `strokeColor` — 非 undefined（否则文字不可见）
- 文本元素：`text`, `originalText`, `fontSize`, `fontFamily` = 3
- 箭头元素：`points`, `startBinding`/`endBinding`

## 执行顺序

1. **Phase 1**：运行现有单元测试，确认基线通过
   - `npm run test:run -- tests/unit/agent/tools/excalidraw.test.ts`
   - 退出：全部通过

2. **Phase 2**：构建 + 部署到 test-vault
   - `npm run build && npm run deploy`
   - 退出：编译无错

3. **Phase 3**：evalObsidian 端到端测试（4 个场景）
   - 通过 `evalObsidian` 发送对话消息
   - 等待 LLM 回复完成
   - 检查 .excalidraw 文件和聊天回复
   - 退出：场景 1-3 成功生成有效文件，场景 4 不生成文件

4. **Phase 4**：文件结构验证和可视化分析
   - 读取生成的 .excalidraw 文件
   - 验证 JSON 结构完整性
   - 分析元素布局（间距、碰撞、可见性）
   - 退出：无严重结构问题

## 退出条件

- [ ] 单元测试全部通过（12/12）
- [ ] 构建无编译错误
- [ ] 端到端场景 E-EX-1 至 E-EX-4 结果符合预期
- [ ] 生成的 .excalidraw 文件 JSON 结构完整
- [ ] 无假阳性（测试本身无 bug）

## 预估时间

| 阶段 | 预估时间 |
|------|---------|
| Phase 1 单元测试 | ~10s |
| Phase 2 构建+部署 | ~30s |
| Phase 3 端到端（4 场景 x ~60s） | ~4min |
| Phase 4 文件验证 | ~1min |
| **总计** | **~6min** |

## 已知风险

1. **LLM 随机性**：同一查询可能生成不同质量的图形，端到端测试需容忍变化
2. **LLM API 延迟**：每个场景需等待 30-60s，超时需重试
3. **excalidraw 插件依赖**：视觉渲染需要 Obsidian 安装 Excalidraw 插件
4. **edges.ts hasDiagramIntent 返回 false**：当前 visualizer 路由被禁用，绘图功能通过节点内部后处理实现（S1/S3）或工具调用实现（S2）
